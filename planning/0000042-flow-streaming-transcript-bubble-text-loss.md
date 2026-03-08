# Story 0000042 – Flow Streaming Transcript Bubble Text Loss During Live Runs

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Users running Flows (example: `flows/implement_next_plan.json`) can see assistant text stream into the current bubble as expected, but as soon as the next assistant bubble starts, the previous bubble can lose text in the live UI. This is visible in `tmp/missing_text.png`.

If the user navigates away and then returns, all previously missing text appears again (example in `tmp/visible_text.png`), which indicates persistence and snapshot hydration are likely correct and the defect is in live streaming state handling or live render-state transitions.

The issue appears to be Flow-specific from a user point of view. Chat and Agents pages do not show the same user-visible failure pattern under normal use, which suggests Flow’s websocket-driven lifecycle exposes a bug in shared streaming state management more reliably than the other pages.

The expected outcome of this story is simple and user-visible:

- While a Flow run is live, once an assistant bubble has rendered text, later bubbles must not cause that earlier bubble to lose visible text.
- If two Flow steps stream one after another, the first completed or partially completed assistant bubble must keep its already-rendered content on screen while the next step streams.
- Reloading the page should show the same content that remained visible during the live run; the fix should remove the transient loss rather than relying on rehydration to restore it later.

This story does not assume the server or persistence layer is broken. The current evidence points to a client-side live streaming defect, and the plan should remain focused on fixing that source of corruption first.

### Acceptance Criteria

- During a live Flow run, previously rendered assistant bubble text stays visible when later Flow steps begin streaming.
- The fix applies to the shared client streaming path first; `FlowsPage` changes are allowed only as a secondary safeguard if the required Flow regression still fails after the shared fix lands.
- The implementation prevents stale or mismatched non-final websocket events from mutating the active assistant bubble state for a different inflight run.
- The implementation prevents stale or mismatched `user_turn` websocket events from resetting or rebinding the active assistant bubble state for a different inflight run during Flow-style idle streaming.
- Existing late/out-of-band `turn_final` handling remains non-destructive. The fix must not reintroduce the older race where valid finalization for an earlier inflight damages a newer one.
- Chat and Agents streaming behavior does not regress. If the shared hook is changed, existing Chat/Agents protections must keep passing.
- The story adds regression coverage for the exact failure class:
  - hook-level stale `assistant_delta` while Flow-style lifecycle is `idle`
  - hook-level stale `user_turn`, `analysis_delta`, and `tool_event` for the same mismatch pattern
  - websocket-layer lower-sequence same-inflight transcript events are ignored before they reach shared hook state
  - a Flow page integration test showing that earlier bubble text remains visible while the next step streams
- API contracts, websocket event schema, and persistence/Mongo document shapes remain unchanged in this story.
- The plan documents enough implementation guidance that a junior developer can identify:
  - the most likely root cause
  - the files most likely to change
  - the minimum regression tests that must be added
  - the difference between the primary fix and any secondary Flow-page hardening

## Message Contracts & Storage Shapes

This story does not require new transport contracts or persistence shapes for the likely first-pass fix.

- Websocket event contracts:
  - Keep the existing event types and payloads unchanged:
    - `user_turn`
    - `inflight_snapshot`
    - `assistant_delta`
    - `analysis_delta`
    - `tool_event`
    - `stream_warning`
    - `turn_final`
  - Rationale:
    - server websocket events already include `inflightId`
    - `user_turn` and transcript events already include `seq`
    - Flow execution already emits step-level inflight ids
    - the client already receives enough identity information to ignore stale non-final events without changing the wire format

- REST contracts:
  - Keep existing Flow run and conversation/turn endpoints unchanged.
  - No new request fields or response fields are required for the primary fix.

- Persistence/storage shapes:
  - Keep conversation, turn, and inflight snapshot storage shapes unchanged.
  - The current behavior where missing live text reappears after reload is evidence that persistence is already retaining the data this story needs.

- Shared type scope:
  - No new shared client/server type definitions are required to fix the bug.
  - Optional future cleanup such as deduplicating websocket event typings across client/server is out of scope unless needed by a later refactor.

- Explicit boundary:
  - If the primary `useChatStream` fix succeeds, this story should ship without contract or schema changes.
- Contract or storage work is not part of this story. The current websocket contract and persistence layer already expose the fields required for the client-side fix.

### Out Of Scope

- Changing server API shapes, websocket event names, or Mongo persistence schema as part of the first-pass fix.
- Rewriting Flow transcript rendering or redesigning bubble layout/styling.
- Solving unrelated Flow sidebar/filtering issues unless they are still needed as a small secondary safeguard after the primary `useChatStream` fix lands.
- Adding synthetic Flow-only `sending` state just to activate existing guards. The plan’s current recommendation is to fix inflight safety directly instead.
- Implementing code fixes in this planning story.
- Running wrapper tests/builds/system commands for validation in this planning story.
- UX redesign of bubble layout/styling unrelated to this streaming state defect.

### Questions

## Research Notes

- Scope verdict:
  - This story is well scoped as a client-side live streaming state bug fix.
  - Current evidence does not justify widening the story into server contract, websocket schema, or persistence work.

- Why the scope is considered correct:
  - The branch already contains a deterministic failing hook regression (`client/src/test/useChatStream.inflightMismatch.test.tsx`) proving stale `assistant_delta` data for an earlier inflight can overwrite the currently active shared assistant refs during a Flow-style websocket lifecycle.
  - `useChatStream` currently guards inflight mismatches for non-final events only when `status === 'sending'`, but Flow runs usually stay `idle` because they do not use the normal `send()` path.
  - Server websocket events already carry `inflightId`, and Flow execution emits step-level inflight transitions, so the client has the information needed to reject stale non-final events without changing contracts.
  - The bug is transient and rehydration restores the missing text, which is consistent with live client-state corruption rather than lost persisted data.

- What was checked during research:
  - Repo code paths:
    - `client/src/hooks/useChatStream.ts`
    - `client/src/pages/FlowsPage.tsx`
    - `client/src/test/useChatStream.inflightMismatch.test.tsx`
    - `server/src/ws/types.ts`
    - `server/src/flows/service.ts`
    - `server/src/ws/sidebar.ts`
    - `server/src/mongo/repo.ts`
  - External guidance:
    - React docs for `useRef` note that refs are mutable, do not trigger re-render, and are not appropriate for values that drive rendered output if those values can become stale or inconsistent.

- Confirmed secondary risk:
  - `FlowsPage` has a separate conversation-visibility reset path tied to `flowConversations`. That logic can still cause additional transient UI loss even after the primary hook fix lands.
  - This is not an open investigation. Execute the `FlowsPage` safeguard task only if the automated Flow regression introduced in this story still fails after the shared-hook tasks are complete.

- Tool availability note:
  - DeepWiki MCP is not currently usable for this repository because the repo is not indexed there.
  - Context7 was attempted for React/Codex reference material, but the configured Context7 access failed during this pass, so primary web sources and direct code inspection were used instead.

## Edge Cases and Failure Modes

- Two sequential Flow steps use different inflight ids, and a late non-final event from the earlier step arrives while the later step is active:
  - expected result: the stale earlier event is ignored and must not change the later step's live state or remove already-rendered text from the earlier bubble

- A stale `stream_warning` or `inflight_snapshot` arrives for an earlier inflight while a newer inflight is active:
  - expected result: the stale event is ignored and must not overwrite assistant text, reasoning text, tool state, warnings, or other refs that now belong to the newer inflight

- A late `turn_final` for an earlier inflight arrives after a newer inflight has already started:
  - expected result: the finalization remains non-destructive and must not overwrite or clear the newer inflight's visible content

- A lower-sequence non-final event for the same inflight arrives after a higher-sequence event or after the bubble is effectively finalized:
- expected result: older same-inflight websocket events must be ignored before they can reach shared hook state, and stale cross-inflight events that do reach the hook must not re-mutate the visible bubble content

- Flow stays in `status='idle'` for websocket-driven streaming:
  - expected result: stale-event protection still works even though the page did not use the normal `send()` path

- Chat and Agents continue to use the shared hook after the fix:
  - expected result: they keep their current behavior and do not regress just because Flow needed stricter inflight matching

- `FlowsPage` temporarily loses the active conversation from `flowConversations` during sidebar/filter churn:
  - expected result: the shared-hook fix remains the primary correction, and the page must stay unchanged unless the automated Flow regression still fails after Tasks 1-6
  - if the active conversation is reset during a live stream and Task 6 still fails, Task 7 must harden only the `flowConversations` visibility/reset path without widening scope into unrelated sidebar behavior

- Reload/rehydration after the bug:
  - expected result: persisted turns should continue to show the correct content after reload, and the live fix should make that same content remain visible without requiring navigation away and back

- Shared-consumer regression matrix:
  - expected result: after the `useChatStream` fix, `ChatPage`, `AgentsPage`, and `FlowsPage` all continue to behave correctly because they all forward transcript websocket events through the same shared hook

## Implementation Ideas

- Recommended implementation outline:
  - Start in `client/src/hooks/useChatStream.ts`, because the proven corruption occurs where shared websocket transcript events mutate shared assistant refs/state.
  - Replace the current `status === 'sending'` mismatch protection for non-final events with strict inflight-identity protection. The hook should ignore stale mismatched `assistant_delta`, `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` updates before they can mutate the active bubble state.
  - Keep `turn_final` handling explicit and separate. Older finals may still arrive late, so finalization logic should remain non-destructive even while non-final stale events are ignored.
  - Do not introduce synthetic Flow-only `sending` state. `status` should remain a UI/send-path concept, not the authority for websocket event ownership.
  - Treat `client/src/pages/FlowsPage.tsx` as secondary hardening only. If the hook fix removes the text-loss bug, leave Flow page behavior alone unless the existing `flowConversations` visibility/reset path still causes separate transient transcript clearing.
  - Regression-check all `useChatStream` consumers after the hook change: `ChatPage`, `AgentsPage`, and `FlowsPage`.

- Investigation timestamp context:
  - Initial report and investigation date: 2026-03-04.
  - User-provided visual evidence:
    - Missing live text: `tmp/missing_text.png`
    - Text restored after navigation: `tmp/visible_text.png`

- Reproduction summary:
  - Start a Flow run (`flows/implement_next_plan.json` is a known reproducer).
  - Observe assistant bubble N streaming content.
  - When bubble N+1 starts, bubble N may lose visible text in live UI.
  - Navigate away and return.
  - Bubble N text reappears from persisted/snapshot state.

- Most likely root cause:
  - `useChatStream` transcript event handling gates mismatched inflight updates with `status === 'sending'`.
  - Flow runs use websocket-driven `runFlow` lifecycle and usually keep `status` at `idle`.
  - Result: out-of-band/mismatched events can still mutate shared assistant refs and sync them into bubbles, overwriting live content.

- Primary evidence (client):
  - Flow run path does not enter `send()`:
    - `client/src/pages/FlowsPage.tsx:696`
    - `startFlowRun` uses `runFlow(...)` and websocket subscription.
  - `status` becomes `sending` in chat send path:
    - `client/src/hooks/useChatStream.ts:964`
  - Mismatch guards tied to `status === 'sending'`:
    - `client/src/hooks/useChatStream.ts:1444` (`assistant_delta`)
    - `client/src/hooks/useChatStream.ts:1499` (`analysis_delta`)
    - `client/src/hooks/useChatStream.ts:1513` (`tool_event`)
    - `client/src/hooks/useChatStream.ts:1404` (`inflight_snapshot`)
- Shared mutable refs used to compose assistant message content:
  - `client/src/hooks/useChatStream.ts:280`
  - `client/src/hooks/useChatStream.ts:285`
  - `client/src/hooks/useChatStream.ts:416`
  - `client/src/hooks/useChatStream.ts:440`
- Existing helpers that should be reused rather than replaced:
  - `ensureAssistantMessage`
  - `syncAssistantMessage`
  - `resetInflightState`
  - `resetAssistantPointer`
  - websocket sequence filtering in `client/src/hooks/useChatWs.ts`
- Existing test support that should be extended rather than recreated:
  - `client/src/test/support/mockChatWs.ts`
  - `setupChatWsHarness`
  - harness emitters such as `emitUserTurn`, `emitAssistantDelta`, `emitAnalysisDelta`, `emitToolEvent`, `emitStreamWarning`, `emitInflightSnapshot`, and `emitFinal`

- Secondary Flow-specific amplifier:
  - Flow page clears transcript when active conversation falls out of filtered `flowConversations`.
  - This can cause additional transient disappearance but is less consistent with the user screenshot pattern than the inflight mismatch path.
  - Evidence:
    - `client/src/pages/FlowsPage.tsx:488`
    - `client/src/pages/FlowsPage.tsx:495`
    - `client/src/pages/FlowsPage.tsx:497`
  - Note:
    - Existing flow test already guards one related case where `conversation_upsert` omits `flowName`:
      - `client/src/test/flowsPage.test.tsx:219`

- Why Chat/Agents usually show this less:
  - Chat commonly streams through `send()`, which sets `status='sending'`, activating existing mismatch short-circuit paths.
  - Agents can still share core hook behavior, but observed lifecycle and user interaction pattern more often keep mismatch behavior from becoming user-visible.

- Server-side investigation notes:
  - `conversation_upsert` payload path generally preserves `flowName` when present:
    - `server/src/mongo/repo.ts:39`
    - `server/src/ws/sidebar.ts:27`
  - No strong evidence found that persistence is dropping content, matching user observation that content reappears after reload.

- Existing tests and gaps:
  - Existing coverage for late `turn_final` race exists:
    - `client/src/test/chatPage.stream.test.tsx:369`
  - Existing shared-consumer regression surface to re-run after the hook fix:
    - `client/src/test/chatPage.stream.test.tsx`
    - `client/src/test/agentsPage.streaming.test.tsx`
  - Added proof-of-failure regression on this branch:
    - `client/src/test/useChatStream.inflightMismatch.test.tsx`
    - Wrapper command: `npm run test:summary:client -- --file client/src/test/useChatStream.inflightMismatch.test.tsx`
    - Result observed on 2026-03-07: failing as expected.
    - Failure evidence:
      - Summary log: `test-results/client-tests-2026-03-07T10-22-03-153Z.log`
      - Key assertion: expected first assistant bubble content to remain `First reply`, received ` late tail` after a stale mismatched `assistant_delta` arrived for the prior inflight.
    - Scope of proof:
      - This is a deterministic hook-level proof that current `useChatStream` logic permits cross-inflight assistant bubble corruption in a Flow-style websocket lifecycle without using `send()`.
  - Missing targeted coverage:
    - Late/out-of-band `assistant_delta` while `status='idle'` and inflight mismatch (Flow-like lifecycle).
    - Late/out-of-band `analysis_delta` and `tool_event` under same conditions.
    - Flow page integration scenario asserting previous bubble text is retained when next flow step starts streaming.
    - Explicit regression check that the hook fix does not break existing Chat or Agents late-event behavior.

- Implementation paths considered:
  - Primary fix for this story:
    - In `useChatStream`, always isolate or ignore mismatched inflight deltas and tool/reasoning events independent of `status`.
    - Keep `turn_final` out-of-band completion behavior explicit and non-destructive.
  - Larger refactor deliberately not chosen as first pass:
    - Track stream state per inflight ID instead of shared refs to remove cross-inflight mutation risk.
    - This remains a fallback only if the smaller source-level fix proves insufficient.
  - Secondary safeguard only if still needed after the primary fix:
    - In Flow page, avoid hard transcript clear on temporary filtered-list absence; debounce/confirm before reset.

  - Suggested verification approach for implementation story:
  - Add hook-level tests reproducing mismatched delta events while `status='idle'`.
  - Add Flow page regression test that simulates two sequential flow-step inflights and asserts prior bubble text remains visible in live UI.
  - Keep existing late `turn_final` regression tests passing.
  - Manual validation in Flows with a known multi-step flow (`flows/implement_next_plan.json`) and screenshot before/after fix.

- Resolved implementation decisions and rationale:
  - Decision 1:
    - Mismatched `assistant_delta`, `analysis_delta`, and `tool_event` updates should be ignored for the currently active shared refs unless the event is explicitly tied to a separately isolated inflight state.
    - Why this is needed:
      - The current hook keeps assistant text, reasoning text, segments, warnings, and tool calls in shared mutable refs. Allowing a stale inflight to write into those refs is the corruption mechanism proven by the added regression test.
    - Why this is the best option:
      - It is the smallest safe correction to the proven bug.
      - It aligns stream safety with inflight identity instead of an unrelated UI status flag.
      - It avoids introducing a larger refactor unless a later change shows isolated per-inflight state is required.

  - Decision 2:
    - The `status === 'sending'` guard should not be the authority for websocket inflight safety. Strict inflight matching should govern whether streamed updates are allowed to mutate active shared refs.
    - Why this is needed:
      - `status` describes whether `send()` was used, not whether websocket events belong to the currently active inflight.
      - Flow runs do not use `send()`, so relying on `status` leaves the exact proven bug path open.
    - Why this is the best option:
      - It fixes the actual identity problem instead of masking it for one page mode.
      - It keeps Chat, Agents, and Flows on one coherent rule: only the matching inflight may mutate active shared streaming state.

  - Decision 3:
    - Flow should not rely on setting `useChatStream` into a synthetic sending state to stay correct. Stream safety should be decoupled from `status`.
    - Why this is needed:
      - Forcing Flow into `sending` would be a workaround rather than a real fix.
      - It would preserve the mismatch bug in any other lifecycle that is websocket-driven but not created through `send()`.
    - Why this is the best option:
      - It keeps `status` semantics honest and narrow.
      - It prevents future pages or reconnect flows from depending on accidental UI state to remain correct.

  - Decision 4:
    - Flow conversation visibility reset logic is a confirmed secondary risk, but it must only be changed if the automated Flow regression still fails after the shared-hook tasks are complete.
    - Why this is needed:
      - Flow still has a separate transcript-clearing path when the active conversation falls out of the filtered list.
      - That behavior can amplify confusion during websocket/sidebar churn even if the core inflight bug is fixed.
    - Why this is the best option:
      - It reduces additional transient UI loss without distracting from the primary corruption fix.
      - It keeps the implementation layered: first stop wrong-stream writes, then change `FlowsPage` only if the required regression still proves a page-local gap.

  - Decision 5:
    - The minimum regression matrix should include:
      - a hook-level stale mismatched `assistant_delta` case while `status='idle'`,
      - equivalent hook-level stale `analysis_delta` and `tool_event` cases,
      - a Flow page integration test covering two sequential step inflights with prior bubble retention,
      - preservation of existing Chat and Agents late-`turn_final` protections.
    - Why this is needed:
      - The defect is in shared hook behavior but becomes most visible in Flow lifecycle.
      - A single page test is too broad for root-cause diagnosis, and a single hook test is too narrow for UI regression confidence.
    - Why this is the best option:
      - It gives one fast root-cause test, one user-visible integration test, and coverage that prevents regressions across all consumers of `useChatStream`.

- Recommended implementation order:
  - Step 1:
    - Apply the primary fix in `client/src/hooks/useChatStream.ts`.
    - Replace the current `status === 'sending'` mismatch safety rule for non-final websocket stream events with strict inflight identity checks so stale non-final events cannot mutate the active shared assistant refs.
    - Why first:
      - This is the source of the proven corruption.
      - It fixes the upstream data/state mutation point shared by Flow, Chat, and Agents.
  - Step 2:
    - Preserve and review the existing out-of-band `turn_final` behavior separately.
    - Keep finalization non-destructive for older inflights because completion metadata can still arrive late and should not damage a newer run.
    - Why second:
      - `turn_final` is already treated differently from token/reasoning/tool deltas and should remain explicit.
  - Step 3:
    - Expand the regression set after the hook fix:
      - flip the proof test to passing,
      - add stale `analysis_delta` and `tool_event` hook tests,
      - run nearby Chat and Agents streaming regressions.
    - Why third:
      - It verifies the source-level fix without mixing in unrelated UI changes.
  - Step 4:
    - Run Task 6 after the source-level fix lands, and execute Task 7 only if that automated Flow regression still fails.
    - Why fourth:
      - The product should avoid papering over corrupted upstream state with downstream workarounds.
      - A failing Task 6 regression provides the concrete signal needed to justify a narrow `FlowsPage` safeguard.

- Explicit recommendation:
  - Use a KISS-but-correct approach:
    - fix the source defect in `useChatStream`,
    - avoid synthetic Flow-only state tricks such as forcing a fake `sending` state,
    - avoid starting with component-level defensive patches for data that should never have been corrupted upstream.
  - Why this is the recommended approach:
    - It aligns with product robustness and stability goals.
    - It reduces long-term maintenance cost by enforcing a correct invariant at the shared stream-state layer.
    - It keeps downstream pages simpler and avoids spreading compensating logic through Flow-specific UI code unless evidence later shows a separate UI reset bug remains.

# Tasks

### 1. Shared hook fix: stale `assistant_delta` must not corrupt later inflights

- Task Status: `__done__`
- Git Commits:
  - `ee878917` - `DEV-[0000042] - Keep finalized stale user_turn replays ignored`
  - `cd3c9877` - `DEV-[0000042] - Guard stale assistant deltas in shared flow streaming`

#### Overview

Fix the proven root-cause path in `useChatStream` where a stale `assistant_delta` for an older inflight can overwrite the currently active assistant bubble during a Flow-style websocket lifecycle. This task should be the first implementation step because it addresses the exact failing proof already recorded in the story.

#### Documentation Locations

- React 19.2 `useRef`: https://react.dev/reference/react/useRef
  - use this for the current ref semantics the hook relies on when storing inflight IDs, message IDs, and streamed text outside render state
- React 19.2 state snapshots: https://react.dev/learn/state-as-a-snapshot
  - use this for reasoning about why ref mutations do not re-render and why visible bubble updates must still flow through state sync helpers
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface in the repo when writing or updating tests
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for the current test runner, assertions, and mocking model used by the client test suite
- React Testing Library (`@testing-library/react` 16.x): https://testing-library.com/docs/react-testing-library/intro/
  - use this for `renderHook`, `act`, `screen`, and `waitFor` patterns used in the hook regressions
- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
  - use this for the event-driven transport model the client hook is reacting to
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` diagrams for the shared stream-state architecture

#### Subtasks

1. [x] Read the current proof test and the shared stream hook before changing code.
   - Files to read:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the existing failing proof test `keeps the previous assistant bubble content when a stale delta arrives after the next Flow-style user_turn`
     - the `assistant_delta` branch inside `handleWsEvent` in `client/src/hooks/useChatStream.ts`
   - Documentation for this subtask:
     - React 19.2 `useRef`: https://react.dev/reference/react/useRef
     - React 19.2 state snapshots: https://react.dev/learn/state-as-a-snapshot
   - Goal:
     - understand exactly how a stale `assistant_delta` for an older inflight currently mutates the active shared refs
     - identify where to reuse `ensureAssistantMessage`, `syncAssistantMessage`, `resetInflightState`, and `resetAssistantPointer` instead of adding new helper functions
   - When this subtask is complete:
     - you can point to the exact lines where `assistant_delta` still accepts a mismatched inflight while `status !== 'sending'`
2. [x] Update `client/src/hooks/useChatStream.ts` so stale mismatched `assistant_delta` events are rejected by inflight identity even when `status !== 'sending'`.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the `assistant_delta` branch in `handleWsEvent`
     - reuse `ensureAssistantMessage` and `syncAssistantMessage`; do not create a new bubble-tracking helper
   - Documentation for this subtask:
     - React 19.2 `useRef`: https://react.dev/reference/react/useRef
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Required behavior:
     - keep the current matching-inflight happy path working
     - do not introduce synthetic Flow-only `sending` state
     - do not change websocket contracts or page-level event shapes
     - reuse the existing assistant-message targeting and sync helpers instead of creating parallel bubble-management logic
   - When this subtask is complete:
     - a mismatched stale `assistant_delta` no longer mutates the active refs or visible active bubble
3. [x] Add or update a structured client log line for the stale `assistant_delta` ignore path.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the `assistant_delta` branch inside `handleWsEvent`
     - reuse `logWithChannel(...)` rather than adding direct `console.*` calls
   - Required log line:
     - `chat.ws.client_assistant_delta_ignored`
   - Required payload:
     - `conversationId`
     - `ignoredInflightId`
     - `activeInflightId`
     - `assistantMessageId`
     - `reason: 'stale_inflight'`
   - Purpose:
     - give the Manual Playwright-MCP check a stable console marker proving the stale delta was rejected instead of mutating UI state
   - When this subtask is complete:
     - a stale older-inflight delta emits `chat.ws.client_assistant_delta_ignored` exactly when the event is ignored
4. [x] Update the stale `assistant_delta` regression test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - keep the existing stale `assistant_delta` proof test and make it pass by asserting that earlier bubble text remains visible after a stale older-inflight delta arrives
   - Purpose:
     - prove the exact reported bug no longer reproduces in the shared hook
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
5. [x] Add a matching-inflight `assistant_delta` happy-path regression.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add or update a test that proves a delta for the active inflight still appends text to the correct assistant bubble after the stale-event guard is added
   - Purpose:
     - prove the fix does not break the normal streaming path while blocking stale events
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
6. [x] Update `design.md` with the `assistant_delta` ownership rule and any affected shared-stream mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document that stale `assistant_delta` events must not mutate the active inflight
     - update any stream-state or websocket-flow mermaid diagram affected by the new rule
7. [x] Update this story file’s Implementation notes for Task 1 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task1-assistant-delta-retained.png`, review that screenshot to confirm the earlier assistant bubble text stays visible after the stale delta arrives, and confirm the debug console contains `chat.ws.client_assistant_delta_ignored` with `reason: 'stale_inflight'` and no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
6. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Read `client/src/test/useChatStream.inflightMismatch.test.tsx` and the `assistant_delta` branch in `client/src/hooks/useChatStream.ts`; confirmed mismatched deltas still fall through whenever `status !== 'sending'`, which is the Flow idle-streaming bug path.
- Subtask 2: Updated `useChatStream` so mismatched `assistant_delta` events return before mutating active refs; the fix keeps assistant bubble ownership tied to inflight identity instead of `status`.
- Subtask 3: Added `chat.ws.client_assistant_delta_ignored` with the required stale-inflight payload so the manual browser check has a stable proof point.
- Subtask 4: Kept the original stale-delta regression and flipped it to the passing expectation that the first bubble stays visible after the stale event.
- Subtask 5: Added a matching-inflight happy-path regression to prove valid assistant deltas still append to the active bubble.
- Subtask 6: Updated `design.md` with the assistant-delta ownership rule and a mermaid sequence showing stale older-inflight deltas being ignored.
- Subtask 7: Recorded the Task 1 code and validation outcomes here after the full wrapper pass and manual browser check completed.
- Subtask 8: `npm run lint --workspaces` completed with existing server import-order warnings but no errors; `npm run format:check --workspaces` passed without changes.
- Testing 1: `npm run build:summary:client` passed; inspected `logs/test-summaries/build-client-latest.log` and the only warning was the existing Vite chunk-size warning rather than a Task 1 regression.
- Testing 2: `npm run test:summary:client` passed with 469/469 tests green; the full wrapper log was `test-results/client-tests-2026-03-07T15-52-38-144Z.log`.
- Testing 3: `npm run compose:build:summary` passed with both compose build items green; no compose build diagnosis was needed.
- Testing 4: `npm run compose:up` started the stack successfully; server and client containers reached started/healthy state for manual verification.
- Testing 5: Manual Playwright validation used `http://host.docker.internal:5001`, saved `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task1-assistant-delta-retained.png`, showed the existing assistant bubble staying visible while a synthetic next-step prompt was active, and `/logs` confirmed `chat.ws.client_assistant_delta_ignored` with `reason: 'stale_inflight'`; browser console error output stayed empty.
- Testing 6: `npm run compose:down` stopped the stack cleanly after the manual verification pass.

---

### 2. Shared hook fix: stale `user_turn` must not rebind the active inflight

- Task Status: `__done__`
- Git Commits:
  - `91fd85c6` - `DEV-[0000042] - Ignore stale user_turn replays in shared streaming`

#### Overview

Handle the `user_turn` branch separately from later transcript events. This task exists on its own because `user_turn` can reset the assistant pointer and change the active inflight, which is a different failure mode from deltas, warnings, and snapshots.

#### Documentation Locations

- React 19.2 `useRef`: https://react.dev/reference/react/useRef
  - use this for the ref ownership rules that apply to `inflightIdRef`, assistant pointers, and other mutable values inside `useChatStream`
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface in the repo when writing or updating tests
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for the client-side regression test structure and current mocking/assertion behavior
- React Testing Library (`@testing-library/react` 16.x): https://testing-library.com/docs/react-testing-library/intro/
  - use this for hook-test APIs such as `renderHook`, `act`, and `waitFor`
- React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
  - use this for understanding how websocket-driven updates should synchronize with rendered state
- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
  - use this for the event ownership model the `user_turn` path participates in
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` diagrams for inflight ownership and `user_turn` transitions

#### Subtasks

1. [x] Read the `user_turn` branch in the shared hook and list which refs/state it mutates before changing code.
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the `if (event.type === 'user_turn')` branch inside `handleWsEvent`
     - focus on `resetAssistantPointer`, `inflightIdRef.current`, and `ensureAssistantMessage`
   - Documentation for this subtask:
     - React 19.2 `useRef`: https://react.dev/reference/react/useRef
     - React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
   - Reuse target:
     - extend the existing `handleWsEvent` branch and shared refs/helpers in `useChatStream` rather than introducing a second websocket event dispatcher
2. [x] Update `client/src/hooks/useChatStream.ts` so stale mismatched `user_turn` events are ignored consistently during Flow-style idle streaming.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the `shouldResetAssistantPointer` calculation and the `if (nextInflightId) { ... }` assignment block inside the `user_turn` branch
   - Documentation for this subtask:
     - React 19.2 `useRef`: https://react.dev/reference/react/useRef
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Required behavior:
     - a stale earlier-inflight `user_turn` must not reset the assistant pointer, change `inflightIdRef`, or rebind the active assistant bubble
     - a legitimate next-step `user_turn` for a new inflight must still create or target the correct next assistant bubble
     - reuse existing reset and assistant-targeting helpers instead of introducing new refs or duplicate state containers
   - When this subtask is complete:
     - stale `user_turn` for an old inflight becomes a no-op for active bubble targeting, but valid next-step `user_turn` still advances the transcript
3. [x] Add or update a structured client log line for the stale `user_turn` ignore path.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the `user_turn` branch inside `handleWsEvent`
     - reuse `logWithChannel(...)` rather than adding direct `console.*` calls
   - Required log line:
     - `chat.ws.client_user_turn_ignored`
   - Required payload:
     - `conversationId`
     - `ignoredInflightId`
     - `activeInflightId`
     - `reason: 'stale_inflight'`
   - Purpose:
     - give the Manual Playwright-MCP check a stable console marker proving a stale `user_turn` replay was ignored
   - When this subtask is complete:
     - a stale older-inflight `user_turn` emits `chat.ws.client_user_turn_ignored` instead of rebinding the active bubble
4. [x] Add a stale `user_turn` regression test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add or update a test that sends a stale older-inflight `user_turn` after a newer inflight is already active and asserts the active bubble state is unchanged
   - Purpose:
     - prove the new guard blocks the `user_turn` corruption path
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
5. [x] Add a same-inflight `user_turn` replay no-op test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add a test that replays `user_turn` for the currently active inflight and proves it does not reset the assistant pointer or create a duplicate active assistant bubble
   - Purpose:
     - protect the idempotent happy path while the stale-event guard is added
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
6. [x] Re-run nearby shared-hook consumer regressions for Chat and Agents to prove the `user_turn` filtering does not break them.
   - Files to read/edit only if failures require updates:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
7. [x] Update `design.md` with the `user_turn` ownership rule and any affected mermaid diagram for inflight transitions.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document that stale `user_turn` must not rebind active inflight ownership
     - update any transcript or inflight-transition mermaid diagram affected by this rule
8. [x] Update this story file’s Implementation notes for Task 2 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task2-user-turn-retained.png`, review that screenshot to confirm the active assistant bubble is not reset when the stale `user_turn` replays, and confirm the debug console contains `chat.ws.client_user_turn_ignored` with `reason: 'stale_inflight'` and no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
6. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Read the `user_turn` branch in `client/src/hooks/useChatStream.ts`; confirmed it can currently reset the assistant pointer, set `inflightIdRef`, create/retarget the assistant bubble via `ensureAssistantMessage`, and then update visible user messages even when an older inflight replays late.
- Subtask 2: Added an older-inflight replay guard in the `user_turn` branch so already-mapped stale inflights return before resetting assistant ownership or rewriting `inflightIdRef`.
- Subtask 3: Added `chat.ws.client_user_turn_ignored` with the required stale-inflight payload for manual and log-based verification.
- Subtask 4: Added a hook regression proving a stale older-inflight `user_turn` replay no longer steals the active assistant bubble from the newer inflight.
- Subtask 5: Added a same-inflight replay regression proving duplicate `user_turn` for the active inflight stays idempotent and does not create a second assistant bubble.
- Subtask 6: Re-ran nearby shared-consumer regressions with targeted wrapper runs for `chatPage.stream.test.tsx` and `agentsPage.streaming.test.tsx`; both stayed green after the shared-hook change.
- Subtask 7: Updated `design.md` so the assistant-bubble ownership section now covers stale `user_turn` replay handling and the related manual log marker.
- Subtask 8: Recorded the Task 2 code and validation outcomes here after the wrapper pass and manual stale-`user_turn` browser replay completed.
- Subtask 9: `npm run lint --workspaces` completed with the same existing server import-order warnings and no errors; `npm run format:check --workspaces` passed cleanly.
- Testing 1: `npm run build:summary:client` passed; inspected `logs/test-summaries/build-client-latest.log` and the only warning remained the existing Vite chunk-size warning.
- Testing 2: `npm run test:summary:client` passed with 471/471 tests green; the full wrapper log was `test-results/client-tests-2026-03-07T16-12-24-963Z.log`.
- Testing 3: `npm run compose:build:summary` passed with both compose build items green; no compose build follow-up was needed.
- Testing 4: `npm run compose:up` started the stack successfully; the server reached healthy state and the client started for manual verification.
- Testing 5: Manual Playwright validation used `http://host.docker.internal:5001`, saved `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task2-user-turn-retained.png`, showed the active processing bubble remaining on the newer step while the stale older-inflight replay was ignored, and `/logs` confirmed `chat.ws.client_user_turn_ignored` with `reason: 'stale_inflight'`; browser console error output stayed empty.
- Testing 6: `npm run compose:down` stopped the stack cleanly after the Task 2 manual verification pass.

---

### 3. Shared hook fix: stale non-final events beyond `assistant_delta` and `user_turn`

- Task Status: `__done__`
- Git Commits:
  - `4d5042fb` - `DEV-[0000042] - Guard stale non-final transcript events in shared streaming`

#### Overview

Extend the inflight mismatch rule to the remaining shared-hook event types that can mutate visible transcript state: `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot`. Keeping this separate from `user_turn` makes the implementation and tests narrower and easier to verify.

#### Documentation Locations

- React 19.2 `useRef`: https://react.dev/reference/react/useRef
  - use this for the shared mutable refs that collect reasoning, warnings, tool state, and snapshot text between renders
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface in the repo when writing or updating tests
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for the regression test structure used in the hook and page suites
- React Testing Library (`@testing-library/react` 16.x): https://testing-library.com/docs/react-testing-library/intro/
  - use this for hook and component test helpers used in the current client suite
- React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
  - use this for reasoning about non-final event updates reaching the rendered transcript
- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
  - use this for the non-final event delivery model being filtered in this task
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` diagrams for non-final event handling in the shared stream path

#### Subtasks

1. [x] Read the remaining non-final event branches in the shared hook before changing code.
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Start here in code:
     - the `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` branches inside `handleWsEvent`
   - Documentation for this subtask:
     - React 19.2 `useRef`: https://react.dev/reference/react/useRef
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Event branches to inspect:
     - `analysis_delta`
     - `tool_event`
     - `stream_warning`
     - `inflight_snapshot`
   - Reuse target:
     - extend the existing `handleWsEvent` branches and shared refs/helpers in `useChatStream` rather than introducing new event containers
2. [x] Update `client/src/hooks/useChatStream.ts` so stale mismatched non-final events are ignored consistently during Flow-style idle streaming.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - keep each change inside the existing event branch; do not move these events into a new shared abstraction for this story
   - Documentation for this subtask:
     - React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   - Required behavior:
     - matching inflight events still update normally
     - stale earlier inflight events do not overwrite reasoning text, warnings, tool state, or snapshot-driven visible state
     - reuse existing reset and assistant-targeting helpers instead of introducing new refs or duplicate state containers
3. [x] Add or update a structured client log line for stale non-final event ignore paths.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` branches inside `handleWsEvent`
     - reuse `logWithChannel(...)` rather than adding direct `console.*` calls
   - Required log line:
     - `chat.ws.client_non_final_ignored`
   - Required payload:
     - `conversationId`
     - `eventType`
     - `ignoredInflightId`
     - `activeInflightId`
     - `reason: 'stale_inflight'`
   - Purpose:
     - give the Manual Playwright-MCP check one stable marker for all non-final event types this task hardens
   - When this subtask is complete:
     - each ignored `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` emits `chat.ws.client_non_final_ignored` with the correct `eventType`
4. [x] Add a matching-inflight `analysis_delta` happy-path test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add a test that sends `analysis_delta` for the active inflight and asserts visible reasoning text updates normally
   - Purpose:
     - prove the new stale guard does not break normal reasoning updates
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
5. [x] Add a stale `analysis_delta` regression test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add a test that sends `analysis_delta` for an older inflight after a newer inflight is active and asserts the visible reasoning state does not change
   - Purpose:
     - prove stale reasoning events are ignored
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
6. [x] Add a matching-inflight `tool_event` happy-path test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add a test that sends a tool event for the active inflight and asserts the visible tool state updates normally
   - Purpose:
     - prove the guard does not break valid tool-call rendering
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
7. [x] Add a stale `tool_event` regression test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add a test that sends a tool event for an older inflight and asserts the active tool state does not change
   - Purpose:
     - prove stale tool events are ignored
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
8. [x] Add a matching-inflight `stream_warning` happy-path test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add a test that sends a warning for the active inflight and asserts the warning becomes visible on the current message
   - Purpose:
     - prove valid warnings still render after the stale-event filter is added
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
9. [x] Add a stale `stream_warning` regression test.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Description:
     - add a test that sends a warning for an older inflight and asserts the active warning list does not change
   - Purpose:
     - prove stale warnings are ignored
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
10. [x] Add a duplicate `stream_warning` dedupe test.

- Test type:
  - hook regression test
- Location:
  - `client/src/test/useChatStream.inflightMismatch.test.tsx`
- Description:
  - add a test that sends the same warning twice for one inflight and asserts it appears only once
- Purpose:
  - protect the no-duplicate warning corner case while warning handling changes
- Documentation for this subtask:
  - Jest 30: https://jestjs.io/docs/getting-started
  - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

11. [x] Add a matching-inflight `inflight_snapshot` happy-path test.

- Test type:
  - hook regression test
- Location:
  - `client/src/test/useChatStream.inflightMismatch.test.tsx`
- Description:
  - add a test that sends an inflight snapshot for the active inflight and asserts the visible transcript state hydrates normally
- Purpose:
  - prove valid snapshots still hydrate the active message
- Documentation for this subtask:
  - Jest 30: https://jestjs.io/docs/getting-started
  - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

12. [x] Add a stale `inflight_snapshot` regression test.

- Test type:
  - hook regression test
- Location:
  - `client/src/test/useChatStream.inflightMismatch.test.tsx`
- Description:
  - add a test that sends an inflight snapshot for an older inflight and asserts the active message state does not get replaced
- Purpose:
  - prove stale snapshots are ignored
- Documentation for this subtask:
  - Jest 30: https://jestjs.io/docs/getting-started
  - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/

13. [x] Re-run nearby shared-hook consumer regressions for Chat and Agents to prove the broader mismatch filtering does not break them.

- Files to read/edit only if failures require updates:
  - `client/src/test/chatPage.stream.test.tsx`
  - `client/src/test/agentsPage.streaming.test.tsx`

14. [x] Update `design.md` with the non-final event filtering rules and any affected mermaid diagram.

- Files to edit:
  - `design.md`
- Documentation for this subtask:
  - Mermaid docs: Context7 `/mermaid-js/mermaid`
- Required content:
  - document how `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` now follow the same inflight-ownership rule
  - update any stream-event mermaid diagram affected by those rules

15. [x] Update this story file’s Implementation notes for Task 3 once the code and tests are complete.

- Files to edit:
  - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`

16. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task3-non-final-state-retained.png`, review that screenshot to confirm the visible reasoning/tool/warning/snapshot state stays correct while stale non-final events are ignored, and confirm the debug console contains `chat.ws.client_non_final_ignored` with the expected `eventType` values and no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
6. [x] `npm run compose:down`

#### Implementation notes

- Reviewed the `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` branches in `useChatStream` plus the existing mismatch tests before editing; the stale guards still rely on `status === 'sending'` outside Task 1 and Task 2 paths.
- Hardened the four remaining non-final branches in `useChatStream` so stale cross-inflight updates return before assistant targeting or ref mutation; `inflight_snapshot` needed the guard moved ahead of `ensureAssistantMessage`.
- Added `chat.ws.client_non_final_ignored` for stale `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` paths with the task-required payload and event type.
- Added a matching-inflight `analysis_delta` regression proving active reasoning still updates the visible assistant bubble.
- Added a stale `analysis_delta` regression proving older-inflight reasoning does not overwrite the newer bubble.
- Added a matching-inflight `tool_event` regression proving active tool-call rendering still updates normally.
- Added a stale `tool_event` regression proving older-inflight tool results do not mutate the current tool state.
- Added a matching-inflight `stream_warning` regression proving active warnings still appear on the current assistant message.
- Added a stale `stream_warning` regression proving older-inflight warnings are ignored after a newer step becomes active.
- Added a duplicate-warning regression to keep same-inflight warning dedupe intact while broadening the stale-event filter.
- Added a matching-inflight `inflight_snapshot` regression proving valid snapshots still hydrate the active assistant bubble.
- Added a stale `inflight_snapshot` regression proving older-inflight snapshots cannot replace the newer visible transcript state.
- Re-ran the nearby Chat and Agents streaming suites; Agents surfaced that unseen next-step snapshots must still create a new bubble, so the snapshot guard was narrowed to ignore only already-mapped older inflights.
- Updated `design.md` to document the shared non-final ignore marker and the `inflight_snapshot` exception for unseen next inflights.
- Ran repo lint and format checks; Prettier initially flagged the expanded hook regression file, so the client format script was rerun and the follow-up checks passed while existing server import-order warnings remained unchanged.
- `npm run build:summary:client` passed; the only warning in `logs/test-summaries/build-client-latest.log` was the existing Vite chunk-size warning, with no Task 3 build regressions.
- `npm run test:summary:client` passed with 480/480 tests green after the snapshot guard was narrowed to keep unseen next-step snapshots working for Agents.
- `npm run compose:build:summary` passed cleanly with both compose build targets green.
- `npm run compose:up` brought the local stack up cleanly with healthy server and client containers for the required browser validation.
- Manual Playwright validation on `http://host.docker.internal:5001/chat` injected a two-inflight non-final event sequence into the real browser WebSocket client, saved `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task3-non-final-state-retained.png`, confirmed the screenshot kept the current snapshot/reasoning/tool/warning state visible, and verified `chat.ws.client_non_final_ignored` for `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` with no browser console errors.
- Recorded the completed Task 3 implementation and validation trail here after the wrapper pass, browser replay, and screenshot review finished.
- `npm run compose:down` stopped the local stack cleanly after the manual Playwright validation.

---

### 4. Shared hook safeguard: late `turn_final` must remain non-destructive

- Task Status: `__done__`
- Git Commits:
  - `4637aa4b` - `DEV-[0000042] - Preserve late turn_final handling in shared streaming`

#### Overview

Keep `turn_final` handling safe after the earlier shared-hook changes land. This task is only about preserving the guarantee that a late finalization for an older inflight cannot damage a newer active run.

#### Documentation Locations

- React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
  - use this for understanding how late async completion should update state without corrupting newer rendered work
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface in the repo when writing or updating tests
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for updating the existing late-final regression tests
- WebSocket message event: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event
  - use this for the final event lifecycle that delivers `turn_final` into the client
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` diagrams for finalization behavior in the shared stream path

#### Subtasks

1. [x] Read the existing `turn_final` handling before changing code.
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Start here in code:
     - the `if (event.type === 'turn_final')` branch inside `handleWsEvent`
     - the existing late-final regression tests in chat and agents streaming tests
   - Documentation for this subtask:
     - React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
     - WebSocket message events: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event
2. [x] Update `client/src/hooks/useChatStream.ts` only as needed to preserve non-destructive late-final behavior while the stricter mismatch filtering is in place.
   - Files to edit only if needed:
     - `client/src/hooks/useChatStream.ts`
   - Documentation for this subtask:
     - React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
     - WebSocket message events: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event
   - Required behavior:
     - a late `turn_final` for an older inflight must not damage the currently active inflight
     - valid finalization data for the matching inflight must still be applied correctly
   - When this subtask is complete:
     - older finals update only their own completed bubble metadata and do not clear or overwrite the newer inflight
3. [x] Add or update a structured client log line for preserved late `turn_final` handling.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the `turn_final` branch inside `handleWsEvent`
     - reuse `logWithChannel(...)` rather than adding direct `console.*` calls
   - Required log line:
     - `chat.ws.client_turn_final_preserved`
   - Required payload:
     - `conversationId`
     - `finalInflightId`
     - `activeInflightId`
     - `reason: 'late_final_non_destructive'`
   - Purpose:
     - give the Manual Playwright-MCP check a stable marker proving a late final was handled without damaging the newer inflight
   - When this subtask is complete:
     - a late older-inflight final emits `chat.ws.client_turn_final_preserved` when the current inflight is intentionally left intact
4. [x] Add a Chat page late-`turn_final` regression test.
   - Test type:
     - page integration regression test
   - Location:
     - `client/src/test/chatPage.stream.test.tsx`
   - Files to read before editing:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Description:
     - add or update a test that delivers a late final for an older inflight after a newer chat run has started and asserts the newer run stays intact
   - Purpose:
     - prove late finals do not corrupt the chat happy path
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Start here in code:
     - reuse the existing late-stream chat tests in `client/src/test/chatPage.stream.test.tsx`
     - reuse the websocket emit helpers from `client/src/test/support/mockChatWs.ts`
   - When this subtask is complete:
     - the test proves an older inflight can finalize without changing the visible newer chat bubble
5. [x] Add an Agents page late-`turn_final` regression test.
   - Test type:
     - page integration regression test
   - Location:
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Files to read before editing:
     - `client/src/test/agentsPage.streaming.test.tsx`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Description:
     - add or update a test that delivers a late final for an older inflight after a newer agent run has started and asserts the newer run stays intact
   - Purpose:
     - prove late finals do not corrupt the agents happy path
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Start here in code:
     - reuse the existing streaming regression structure in `client/src/test/agentsPage.streaming.test.tsx`
     - reuse the websocket emit helpers from `client/src/test/support/mockChatWs.ts`
   - When this subtask is complete:
     - the test proves an older inflight final cannot overwrite or clear the visible newer agent run
6. [x] Add a matching-inflight `turn_final` happy-path regression test.
   - Test type:
     - page integration regression test
   - Location:
     - `client/src/test/chatPage.stream.test.tsx`
   - Files to read before editing:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Description:
     - add or update a test that delivers `turn_final` for the currently active inflight and asserts the completed bubble keeps its text and finishes normally
   - Purpose:
     - prove valid finalization still works while older late finals stay non-destructive
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Start here in code:
     - place this test next to the other chat streaming websocket regressions
     - reuse the same chat harness setup and websocket emit helpers as the late-final tests above
   - When this subtask is complete:
     - the test proves a matching inflight still finishes normally after the stale-event protections were added
7. [x] Re-run shared consumer regression checks after the late-final changes.
   - Files to read/edit only if failures require updates:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
   - Use the commands in this task's `Testing` section after all Task 4 code and test-writing subtasks are complete.
   - When this subtask is complete:
     - the late-final regressions pass in chat and agents, and no shared-hook mismatch test regressed
8. [x] Update `design.md` with the preserved late-final rule and any affected mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document why `turn_final` remains special compared with non-final event filtering
     - update any completion/finalization mermaid diagram affected by this behavior
9. [x] Update this story file’s Implementation notes for Task 4 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task4-late-final-preserved.png`, review that screenshot to confirm the newer visible bubble remains intact when a late older final arrives, and confirm the debug console contains `chat.ws.client_turn_final_preserved` with `reason: 'late_final_non_destructive'` and no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
6. [x] `npm run compose:down`

#### Implementation notes

- Reviewed the `turn_final` branch plus the existing chat and agents late-final tests; the hook already has a non-destructive mismatch path, but it does not emit the Task 4 preservation marker yet.
- Kept the `turn_final` branch special and only changed the late-final path as needed; the main safeguard was stopping late older finals from overwriting shared `threadId` while still leaving their own bubble metadata intact.
- Added `chat.ws.client_turn_final_preserved` with the required late-final payload so the manual browser replay can prove the current inflight was intentionally left untouched.
- Updated the Chat late-final regression to assert both bubbles keep their own text and completed state after the older final arrives.
- Updated the Agents late-final regression to assert the older bubble finalizes while the newer bubble stays processing and visible.
- Added a Chat matching-inflight `turn_final` regression proving the active bubble still completes normally with its text preserved.
- Re-ran the shared hook mismatch suite plus the Chat and Agents streaming suites; all late-final and shared-consumer regressions stayed green after the `threadId` safeguard and preservation log were added.
- Updated `design.md` to document why `turn_final` remains special, the preserved late-final behavior, and the `chat.ws.client_turn_final_preserved` marker used in manual validation.
- Ran repo lint and format checks; Prettier initially flagged the Chat streaming test after the new assertions were added, so the client format script was rerun and the follow-up checks passed while the existing server import-order warnings remained unchanged.
- `npm run build:summary:client` passed; the only warning in `logs/test-summaries/build-client-latest.log` was the existing Vite chunk-size warning rather than a Task 4 regression.
- `npm run test:summary:client` passed with 481/481 tests green after the late-final preservation log and thread-id safeguard were added.
- `npm run compose:build:summary` passed cleanly with both compose build targets green.
- `npm run compose:up` brought the local stack up cleanly with healthy server and client containers for the Task 4 browser replay.
- Manual Playwright validation on `http://host.docker.internal:5001/chat` injected a two-inflight late-final sequence into the real browser WebSocket client, saved `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task4-late-final-preserved.png`, confirmed the screenshot kept the newer bubble processing while the older bubble completed, and verified `chat.ws.client_turn_final_preserved` with `reason: 'late_final_non_destructive'`; browser console error output stayed empty.
- Recorded the completed Task 4 implementation and validation trail here after the wrapper pass, browser replay, and screenshot review finished.
- `npm run compose:down` stopped the local stack cleanly after the manual late-final validation.

---

### 5. Websocket sequence filtering: keep lower-sequence same-inflight events blocked

- Task Status: `__done__`
- Git Commits:
  - `94f754a2` - `DEV-[0000042] - Preserve websocket seq filtering for chat streaming`

#### Overview

Keep same-inflight lower-sequence filtering owned by `useChatWs`. The current websocket layer already has this rule, so this task is primarily about preserving that behavior and proving it with explicit regressions rather than inventing a second sequence filter elsewhere.

#### Documentation Locations

- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface in the repo when writing or updating tests
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for the websocket-layer regression tests in `useChatWs.test.ts`
- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
  - use this for the `send`, `close`, and connection lifecycle behavior modeled by the hook
- WebSocket message event: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event
  - use this for the stale-packet filtering path that receives transcript events
- React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
  - use this for how filtered transport events should affect downstream rendered state
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` diagrams for websocket sequencing and inflight-key ownership

#### Subtasks

1. [x] Read the websocket sequence bookkeeping and existing stale-packet tests before changing code.
   - Files to read:
     - `client/src/hooks/useChatWs.ts`
     - `client/src/test/useChatWs.test.ts`
     - `client/src/test/chatPage.stream.test.tsx`
   - Start here in code:
     - `lastSeqByKeyRef.current`
     - `inflightKey(...)`
     - the branch that drops packets when `seq <= last`
   - Documentation for this subtask:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - WebSocket message events: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event
   - Reuse target:
     - preserve the existing `useChatWs` per-`(conversationId, inflightId)` sequence filter instead of adding a second stale-packet filter in a different layer
2. [x] Update `client/src/hooks/useChatWs.ts` only as needed to preserve lower-sequence same-inflight filtering and sequence reset acceptance for new inflights.
   - Files to edit only if needed:
     - `client/src/hooks/useChatWs.ts`
   - Documentation for this subtask:
     - WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
     - WebSocket message events: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event
   - Required behavior:
     - lower-sequence same-inflight websocket transcript events must continue to be ignored before they reach `handleWsEvent`
     - sequence resets for a new inflight must still be accepted
     - reuse the existing `inflightKey` and `lastSeqByKeyRef` logic instead of creating a new sequence-tracking structure
   - Concrete example for this subtask:
     - if inflight `i2` already accepted `seq: 7`, a later event for the same `(conversationId, i2)` with `seq: 6` must be dropped
     - if the next inflight is `i3`, its first event with `seq: 1` must still be accepted because the inflight key changed
3. [x] Confirm and, if needed, extend the websocket stale-event log line so seq-filtered packets are visible in the browser console.
   - Files to read/edit only if required:
     - `client/src/hooks/useChatWs.ts`
   - Start here in code:
     - the existing `chat.ws.client_stale_event_ignored` log call in `useChatWs`
   - Required log line:
     - `chat.ws.client_stale_event_ignored`
   - Required payload:
     - `reason: 'seq_regression'`
     - `eventType`
     - `inflightId`
     - `seq`
     - `lastSeq`
   - Purpose:
     - give the Manual Playwright-MCP check a stable marker proving lower-sequence same-inflight packets were blocked before reaching the shared hook
   - When this subtask is complete:
     - seq-filtered websocket packets emit `chat.ws.client_stale_event_ignored` with enough payload to distinguish them from other ignored events
4. [x] Add a websocket stale-packet regression for lower-sequence same-inflight events.
   - Test type:
     - websocket hook regression test
   - Location:
     - `client/src/test/useChatWs.test.ts`
   - Files to read before editing:
     - `client/src/test/useChatWs.test.ts`
     - `client/src/hooks/useChatWs.ts`
   - Description:
     - add or update a test that sends a lower-sequence packet for the current inflight and asserts it is dropped before reaching downstream consumers
   - Purpose:
     - prove the transport layer still blocks stale same-inflight packets
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - WebSocket message events: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event
   - Start here in code:
     - reuse the existing websocket hook harness and stale-packet tests in `client/src/test/useChatWs.test.ts`
     - inspect `lastSeqByKeyRef` and `inflightKey(...)` in `client/src/hooks/useChatWs.ts`
   - When this subtask is complete:
     - the test fails if a lower-sequence event reaches `onEvent`
5. [x] Add a sequence-boundary regression for new inflight resets versus stale prior inflight packets.
   - Test type:
     - websocket hook regression test
   - Location:
     - `client/src/test/useChatWs.test.ts`
   - Files to read before editing:
     - `client/src/test/useChatWs.test.ts`
     - `client/src/hooks/useChatWs.ts`
   - Description:
     - add a test that accepts a new inflight starting at `seq: 1` and then proves later packets from the old inflight with lower or equal sequence do not leak through
   - Purpose:
     - protect the corner case where inflight identity changes and sequence numbers restart
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - WebSocket message events: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event
   - Start here in code:
     - reuse the same websocket harness as the stale-packet regression above
     - make the inflight key change explicit in the test input so the expected `seq: 1` accept path is obvious
   - When this subtask is complete:
     - the test proves a new inflight starts fresh while stale packets from the old inflight remain blocked
6. [x] Add a downstream chat-path regression that confirms websocket filtering still supports the visible happy path.
   - Test type:
     - page integration regression test
   - Location:
     - `client/src/test/chatPage.stream.test.tsx`
   - Files to read before editing:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/useChatWs.test.ts`
     - `client/src/test/support/mockChatWs.ts`
   - Description:
     - add or update a test that proves accepted websocket packets still reach the chat page correctly while stale packets remain blocked
   - Purpose:
     - prove the websocket-layer guard does not break the normal consumer path
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Start here in code:
     - reuse the existing chat streaming test setup and websocket emit helpers
     - keep the assertions user-visible: accepted packets should still change rendered chat content
   - When this subtask is complete:
     - the test proves the websocket filter blocks stale traffic without suppressing valid visible chat updates
7. [x] Re-run shared consumer regression checks after the websocket sequence changes.
   - Files to read/edit only if failures require updates:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
     - `client/src/test/useChatWs.test.ts`
     - `client/src/test/chatPage.stream.test.tsx`
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
   - Use the commands in this task's `Testing` section after all Task 5 code and test-writing subtasks are complete.
   - When this subtask is complete:
     - the transport-layer tests and downstream consumer tests all pass together
8. [x] Update `design.md` with the websocket sequence-filtering rule and any affected mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document how lower-sequence same-inflight packets are blocked and how new inflight sequence resets are accepted
     - update any websocket event-flow mermaid diagram affected by this transport rule
9. [x] Update this story file’s Implementation notes for Task 5 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task5-seq-filter-retained.png`, review that screenshot to confirm valid newer packets still update the UI while lower-sequence same-inflight packets are blocked, and confirm the debug console contains `chat.ws.client_stale_event_ignored` with `reason: 'seq_regression'` and no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
6. [x] `npm run compose:down`

#### Implementation notes

- Reviewed `lastSeqByKeyRef`, `inflightKey(...)`, and the existing stale-seq coverage in `useChatWs`; the per-inflight filter already exists and logs stale packets, but the task-specific regressions still need to pin down same-inflight seq rollback versus new-inflight seq reset behavior.
- Kept the transport filter in `useChatWs` and only tightened the existing stale-packet log payload so seq drops remain visible without adding a second sequence tracker downstream.
- Extended `chat.ws.client_stale_event_ignored` so seq-filtered packets now include the task-required `reason: 'seq_regression'` and `eventType` context.
- Updated the websocket hook regression to prove a lower-sequence same-inflight packet is dropped before `onEvent` and emits the expected stale-packet log payload.
- Added a websocket boundary regression proving a new inflight can restart at `seq: 1` while later lower-or-equal sequence packets from the old inflight stay blocked.
- Updated the downstream Chat regression so a valid new-inflight reset still renders visible text while a lower-sequence same-inflight packet is blocked and logged.
- Re-ran the shared hook mismatch suite alongside the websocket and Chat regressions; the transport-layer sequence checks stayed green without regressing the downstream shared-hook protections from Tasks 1 to 4.
- Updated `design.md` to document the per-`(conversationId, inflightId)` sequence invariant, the accepted new-inflight reset behavior, and the `chat.ws.client_stale_event_ignored` transport marker.
- `npm run build:summary:client` passed; `logs/test-summaries/build-client-latest.log` only showed the existing Vite chunk-size warning, with no Task 5 build regression.
- `npm run test:summary:client` passed with 482/482 tests green, keeping the websocket-layer and downstream chat regressions green together in the full client suite.
- `npm run compose:build:summary` passed cleanly with both compose build targets green, so the browser verification can use the updated images without extra container fixes.
- `npm run compose:up` brought the local stack up cleanly with healthy server and client containers for the websocket sequence browser replay.
- Manual Playwright validation on `http://host.docker.internal:5001/chat` injected a two-inflight websocket sequence through the real `useChatWs` message path, saved `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task5-seq-filter-retained.png`, confirmed the UI showed `Second reply` without the stale `Second stale` text, and verified `chat.ws.client_stale_event_ignored` with `reason: 'seq_regression'`, `eventType: 'assistant_delta'`, `inflightId: 'task5-i2'`, `seq: 2`, and `lastSeq: 2`; browser console error output stayed empty.
- Recorded the completed Task 5 implementation and validation trail here after the wrapper pass, browser replay, persisted screenshot, and exact stale-log verification finished.
- `npm run compose:down` stopped the local stack cleanly after the websocket sequence browser validation.

---

### 6. Flow page regression coverage for live transcript retention

- Task Status: `__done__`
- Git Commits:
  - `b6d992ac` - `DEV-[0000042] - Add Flow live transcript retention coverage`

#### Overview

Prove the user-visible Flow behavior is fixed in the actual page during the live streaming scenario that caused the defect. This task stays focused on the required live Flow regression rather than adding extra remount-specific coverage up front.

#### Documentation Locations

- React Router 7 docs (`react-router-dom` 7.9.6 in this repo): https://reactrouter.com/home
  - use this for the router/provider APIs used by the Flow page test setup
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface in the repo when writing or updating tests
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for the test runner and mocking behavior used in the Flow page suite
- React Testing Library (`@testing-library/react` 16.x): https://testing-library.com/docs/react-testing-library/intro/
  - use this for rendering the page and asserting live transcript content
- Testing Library user-event (`@testing-library/user-event` 14.x): https://testing-library.com/docs/user-event/intro/
  - use this for any user-driven interactions needed to start or control Flow runs in tests
- MUI 6.x docs reference for current `FlowsPage` component patterns:
  - MUI MCP `@mui/material@6.4.12`
  - use this because `FlowsPage.tsx` is built from MUI components and page-level changes should keep to the current MUI 6.x patterns already in the app
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` diagrams for Flow transcript behavior

#### Subtasks

1. [x] Read the Flow page websocket handling and active-conversation reset logic before adding page-level regressions.
   - Files to read:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/flowsPage.test.tsx`
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/test/support/mockChatWs.ts`
   - Start here in code:
     - the Flow page websocket event forwarding into `handleWsEvent`
     - `setupChatWsHarness`, especially `emitUserTurn`, `emitAssistantDelta`, and `emitInflightSnapshot`
   - Documentation for this subtask:
     - React Router 7: https://reactrouter.com/home
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Reuse target:
     - use the existing `setupChatWsHarness` helper and emitters from `mockChatWs.ts` for Flow transcript event simulation
2. [x] Add a Flow-page regression test that simulates two sequential Flow step inflights and asserts the earlier assistant bubble text remains visible while the later step streams.
   - Files to edit:
     - `client/src/test/flowsPage.run.test.tsx`
   - Files to read before editing:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/support/mockChatWs.ts`
   - Start here in code:
     - add the new case next to the existing Flow run websocket tests; do not create a new Flow test file for this story
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
     - MUI 6.x reference: MUI MCP `@mui/material@6.4.12`
   - Required assertions:
     - first bubble text remains visible after the next step starts
     - stale earlier-step events do not remove that text from the live UI
     - a stale earlier-step `user_turn` replay does not reset the active transcript or retarget the current assistant bubble
   - Constraint:
     - extend the existing websocket harness and emit helpers rather than creating page-specific websocket mocks
   - When this subtask is complete:
     - the regression fails on the old bug and passes once the shared fix is applied
3. [x] Add a Flow-page happy-path regression that proves the current later-step bubble still streams normally while the earlier bubble stays visible.
   - Test type:
     - page integration regression test
   - Location:
     - `client/src/test/flowsPage.run.test.tsx`
   - Files to read before editing:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/support/mockChatWs.ts`
   - Description:
     - add or update a test that drives two sequential Flow step inflights and asserts the second step still renders its own live text while the first step keeps its already-rendered content
   - Purpose:
     - prove the fix preserves the visible happy path for the active Flow step, not just the stale-event guard for the earlier bubble
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Start here in code:
     - reuse `setupChatWsHarness` and the existing Flow run websocket test setup
     - keep this test separate from the stale-event regression so the happy path remains obvious
   - When this subtask is complete:
     - the test proves the second Flow step continues to render live text while the first bubble remains visible
4. [x] Add or update a structured Flow-page log line for retained live transcript visibility.
   - Files to edit:
     - `client/src/pages/FlowsPage.tsx`
   - Start here in code:
     - reuse the existing `createLogger('client-flows')` logger in `FlowsPage.tsx`
   - Required log line:
     - `flows.page.live_transcript_retained`
   - Required payload:
     - `conversationId`
     - `previousInflightId`
     - `currentInflightId`
     - `reason: 'next_step_started'`
   - Purpose:
     - give the Manual Playwright-MCP check a stable page-level marker proving the earlier bubble stayed visible when the next step began
   - When this subtask is complete:
     - the Flow page emits `flows.page.live_transcript_retained` when the second step starts and the first bubble remains visible
5. [x] Re-run the Flow regressions and nearby Flow tests after the new page tests are added.
   - Files to read/edit only if failures require updates:
     - `client/src/test/flowsPage.test.tsx`
     - `client/src/test/flowsPage.run.test.tsx`
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
   - Use the commands in this task's `Testing` section after all Task 6 code and test-writing subtasks are complete.
   - When this subtask is complete:
     - the new Flow websocket regressions pass and no nearby Flow page tests regress
6. [x] Update `design.md` with the Flow live transcript behavior and any affected Flow mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document the intended Flow live-stream retention behavior once step N+1 starts
     - update any Flow transcript mermaid diagram affected by this regression coverage
7. [x] Update this story file’s Implementation notes for Task 6 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task6-live-transcript-retained.png`, review that screenshot to confirm the earlier bubble remains visible while the later step streams, and confirm the debug console contains `flows.page.live_transcript_retained` with `reason: 'next_step_started'` and no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
6. [x] `npm run compose:down`

#### Implementation notes

- Reviewed the Flow websocket forwarding, active-conversation visibility reset effect, and existing run-test harness; Task 6 can stay regression-first because Tasks 1-5 already fixed the shared stream ownership rules, but the page still has a later Task 7 reset path to avoid touching unless the new regression proves it is needed.
- Added a Flow run regression in `flowsPage.run.test.tsx` that drives two sequential step inflights, proves the first assistant bubble stays visible, and proves stale earlier-step `user_turn`/`assistant_delta` replays do not retarget or erase the live transcript.
- Added a separate Flow run happy-path regression proving the later step still streams its own text while the earlier assistant bubble remains visible.
- Added `flows.page.live_transcript_retained` in `FlowsPage.tsx` using the existing `client-flows` logger and the shared websocket event path, with a seen-inflight guard so stale earlier-step replays do not emit false page-retention markers.
- Re-ran the focused Flow run and nearby Flow page suites with the new websocket harness coverage; both `flowsPage.run.test.tsx` and `flowsPage.test.tsx` stayed green without needing Flow-page reset-path changes.
- Updated `design.md` with a Flow-specific live-transcript-retention note and mermaid sequence so the page-level evidence for step N staying visible during step N+1 is documented separately from the shared hook ownership rules.
- Ran repo lint and format checks; the new Flow run test initially needed a small unused-arg cleanup plus a client-format pass, and the follow-up checks passed with only the existing server import-order warnings remaining.
- `npm run build:summary:client` passed; `logs/test-summaries/build-client-latest.log` only showed the existing Vite chunk-size warning, with no Task 6 build regression.
- `npm run test:summary:client` passed with 484/484 tests green after the Flow live-transcript regressions and page-level retention marker were added.
- `npm run compose:build:summary` passed cleanly with both compose build targets green, so the manual Flow replay can run against the updated stack image set.
- `npm run compose:up` brought the local stack up cleanly with healthy server and client containers for the required Flow browser validation.
- Manual Playwright validation on `http://host.docker.internal:5001/flows` replayed a two-step Flow transcript through the real `useChatWs` page path, saved `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task6-live-transcript-retained.png`, confirmed the earlier `First step answer` bubble stayed visible while `Second step live` streamed, and verified `flows.page.live_transcript_retained` with `reason: 'next_step_started'` and `{ previousInflightId: 'task6-step-1', currentInflightId: 'task6-step-2' }` while browser console error output stayed empty.
- Recorded the completed Task 6 implementation and validation trail here after the focused Flow suites, wrapper pass, clean browser replay, and persisted screenshot all finished.
- `npm run compose:down` stopped the local stack cleanly after the Flow browser validation.

---

### 7. Flow page secondary hardening if Task 6 still fails

- Task Status: `__done__`
- Git Commits:

#### Overview

Apply the smallest Flow-page-only fix only if the automated live Flow regression from Task 6 still fails after Tasks 1-6 are complete. This task is not an investigation step: if Task 6 passes, mark Task 7 as `N/A` in the Implementation notes and do not edit `FlowsPage.tsx`.

#### Documentation Locations

- React Router 7 docs (`react-router-dom` 7.9.6 in this repo): https://reactrouter.com/home
  - use this for the page routing context that still wraps `FlowsPage` during the required automated regressions
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface in the repo when writing or updating tests
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for the conditional page-level regression and mocking workflow
- React Testing Library (`@testing-library/react` 16.x): https://testing-library.com/docs/react-testing-library/intro/
  - use this for verifying the page-level hardening did not change visible transcript behavior
- Testing Library user-event (`@testing-library/user-event` 14.x): https://testing-library.com/docs/user-event/intro/
  - use this for any user-triggered navigation or interaction around the Flow page
- MUI 6.x docs reference for current `FlowsPage` component patterns:
  - MUI MCP `@mui/material@6.4.12`
  - use this because any page-level hardening must preserve the existing MUI 6.x component APIs and layout patterns
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` diagrams for any Flow-specific hardening that changes the page behavior

#### Subtasks

1. [x] Confirm the Task 6 live Flow regression still fails after Tasks 1–6 before touching `FlowsPage.tsx`.
   - Files to read:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/test/flowsPage.test.tsx`
   - Documentation for this subtask:
     - React Router 7: https://reactrouter.com/home
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - When this subtask is complete:
     - either the Task 6 automated regression is still failing and justifies page hardening, or you write `N/A - Task 6 automated regression passed after Tasks 1-6, so no Flow-page change was required` in this task’s Implementation notes and do not edit `FlowsPage.tsx`
2. [x] Apply the smallest `FlowsPage` hardening needed around active conversation visibility/reset behavior.
   - Files to edit only if required:
     - `client/src/pages/FlowsPage.tsx`
   - Files to read before editing:
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/test/support/mockChatWs.ts`
   - Documentation for this subtask:
     - React Router 7: https://reactrouter.com/home
     - MUI 6.x reference: MUI MCP `@mui/material@6.4.12`
   - Constraint:
     - limit this task to the existing `flowConversations` visibility/reset path around the active conversation transcript clear
     - do not add Flow-only fake `sending` state
     - do not widen scope into unrelated sidebar/filter work
     - reuse the existing MUI 6.x component structure already in `FlowsPage.tsx` instead of introducing new UI component patterns unless the failing regression proves it is necessary
   - Start here in code:
     - inspect the active-conversation visibility/reset effect before editing
     - keep `handleWsEvent` wiring untouched unless the failing Task 6 regression proves that wiring is still incorrect
   - When this subtask is complete:
     - the Flow page stops clearing visible transcript state during the proven visibility-churn path without introducing new page-specific stream ownership logic
3. [x] Add or update a structured Flow-page log line for the visibility-reset safeguard.
   - Files to edit only if required:
     - `client/src/pages/FlowsPage.tsx`
   - Start here in code:
     - reuse the existing `createLogger('client-flows')` logger in `FlowsPage.tsx`
   - Required log line:
     - `flows.page.visibility_reset_guarded`
   - Required payload:
     - `conversationId`
     - `reason: 'active_conversation_temporarily_hidden'`
     - `action: 'retain_transcript'`
   - Purpose:
     - give the Manual Playwright-MCP check a stable page-level marker proving the page-local safeguard retained the transcript instead of clearing it
   - When this subtask is complete:
     - the guarded visibility-reset path emits `flows.page.visibility_reset_guarded` whenever it keeps the active transcript visible
4. [x] Add a Flow-page visibility-churn regression for the Task 7 hardening only if Task 7 edits `FlowsPage.tsx`.
   - Test type:
     - page integration regression test
   - Location:
     - `client/src/test/flowsPage.run.test.tsx`
   - Files to read before editing:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/support/mockChatWs.ts`
   - Description:
     - add or update a test that temporarily removes the active Flow conversation from the `flowConversations` view during a live stream and asserts the visible transcript is not cleared by the page-level safeguard
   - Purpose:
     - prove the Task 7 hardening fixes the specific `flowConversations` reset path without widening behavior beyond the intended page-level guard
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Start here in code:
     - reuse the existing Flow run page test setup and websocket harness
     - make the temporary removal of the active conversation explicit in test data so the guard being exercised is obvious
   - When this subtask is complete:
     - the test proves the transcript remains visible through the page-local visibility-churn condition
5. [x] Add a remount/revisit regression only if the page hardening changes behavior around Flow transcript persistence across navigation.
   - Files to edit only if required:
     - `client/src/test/flowsPage.run.test.tsx`
   - Files to read before editing:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/pages/FlowsPage.tsx`
   - Required assertions:
     - the earlier bubble text is still present immediately before remount/navigation
     - the same text is still present after remount/navigation
     - the regression proves the page-level hardening does not reintroduce a live-versus-remount mismatch
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - Start here in code:
     - reuse the same Flow run page test setup as the visibility-churn regression above
   - When this subtask is complete:
     - the page-level safeguard still preserves the same transcript before and after remount/navigation
6. [x] Re-run the Flow regressions and nearby Flow tests after any page-level change.
   - Files to read/edit only if failures require updates:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/test/flowsPage.test.tsx`
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
   - Use the commands in this task's `Testing` section after all Task 7 code and test-writing subtasks are complete.
   - When this subtask is complete:
     - the page-hardening regression passes and the surrounding Flow suites still pass
7. [x] Update `design.md` if the Flow page hardening changed the architecture or Flow behavior, including any affected mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document the Flow-only safeguard only if Task 7 made a real page-level behavior change
     - update any affected Flow mermaid diagram so it matches the final implementation
8. [x] Update this story file’s Implementation notes for Task 7 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task7-visibility-guarded.png`, review that screenshot to confirm the visible transcript is retained when the active conversation temporarily disappears from `flowConversations`, and confirm the debug console contains `flows.page.visibility_reset_guarded` with `action: 'retain_transcript'` and no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
6. [x] `npm run compose:down`

#### Implementation notes

- N/A - Task 6 automated regression passed after Tasks 1-6, so no Flow-page change was required. `FlowsPage.tsx` did not need the conditional visibility-reset hardening and this task closes as not applicable.

---

### 8. Documentation and project structure updates

- Task Status: `__done__`
- Git Commits:
  - `806e9060` - `DEV-[0000042] - Sync streaming retention documentation`

#### Overview

Update the repo documentation so future developers can understand the root cause, the chosen fix, and the regression coverage without having to rediscover the investigation from git history or screenshots.

#### Documentation Locations

- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/
  - use this for updating README, design, and project structure files in the style already used by the repo
- Mermaid docs: https://mermaid.js.org/intro/
  - use this if the design notes need diagram updates while documenting the streaming fix

#### Subtasks

1. [x] Update `README.md` with a short note describing the Flow live-stream transcript bug fix at a high level.
   - Document name:
     - `README.md`
   - Location:
     - repo root `README.md`
   - Files to read before editing:
     - `README.md`
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Description:
     - add a short high-level note in the existing Flows or streaming-related section explaining that previously rendered Flow bubbles now stay visible while later steps stream because stale earlier-step websocket events are ignored
   - Purpose:
     - keep the top-level repo guide accurate without adding deep implementation detail
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Constraint:
     - keep the note short and user/developer focused; do not duplicate the low-level hook internals from `design.md`
2. [x] Update `design.md` to document:
   - the source-level `useChatStream` inflight filtering rule
   - why `turn_final` stays special
   - why Flow-page hardening is secondary rather than primary
   - the manual verification log lines introduced by Tasks 1–7 and what each one proves
   - Document name:
     - `design.md`
   - Location:
     - repo root `design.md`
   - Files to read before editing:
     - `design.md`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/hooks/useChatWs.ts`
     - `client/src/pages/FlowsPage.tsx`
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Description:
     - update the design documentation and mermaid diagrams so they match the final stream-ownership, finalization, and Flow behavior rules implemented by this story
   - Purpose:
     - keep the architecture and behavioral documentation aligned with the code and regression matrix
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
   - Required log lines to document:
     - `chat.ws.client_assistant_delta_ignored`
     - `chat.ws.client_user_turn_ignored`
     - `chat.ws.client_non_final_ignored`
     - `chat.ws.client_turn_final_preserved`
     - `chat.ws.client_stale_event_ignored`
     - `flows.page.live_transcript_retained`
     - `flows.page.visibility_reset_guarded`
3. [x] Update `projectStructure.md` for any new or renamed tests/files created by this story.
   - Document name:
     - `projectStructure.md`
   - Location:
     - repo root `projectStructure.md`
   - Files to read before editing:
     - `projectStructure.md`
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Description:
     - add any newly created or renamed test files and supporting files from this story to the project structure map
   - Purpose:
     - keep the repo file map accurate for later developers and reviewers
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - When this subtask is complete:
     - every newly added or renamed test file from Tasks 1–7 is listed explicitly
     - every file that was removed or renamed during the story is also recorded explicitly
4. [x] Update this story file’s Implementation notes for Task 8 once the documentation work is complete.
   - Document name:
     - `0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Location:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Description:
     - record what documentation changed, why it changed, and any problems encountered while updating the markdown files for Task 8
   - Purpose:
     - preserve a story-local implementation record for the documentation pass
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
5. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run test:summary:client` - Use because this task updates documentation for client-facing behavior and file paths already validated by the story. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
2. [x] `npm run compose:build:summary` - Use because this documentation task still references front-end-testable behavior. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
3. [x] `npm run compose:up`
4. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task8-docs-smoke-check.png`, review that screenshot to confirm the documented Flow behavior still matches the GUI, verify any referenced paths in `projectStructure.md`, and confirm the debug console shows the log markers documented in `design.md` when their corresponding events are triggered, with no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
5. [x] `npm run compose:down`

#### Implementation notes

- Added a short README note under the Flows feature summary explaining the user-visible fix: earlier Flow bubbles stay visible while later steps stream because stale earlier-step transcript events are ignored rather than rebound.
- Updated `design.md` to describe the final shared `useChatStream` ownership rules, keep `turn_final` explicitly non-destructive, explain that Flow-page hardening stayed secondary/N/A, and add a Story 42 log-marker matrix that distinguishes shipped markers from the conditional Task 7 marker.
- Updated `projectStructure.md` to reflect the final Story 42 regression surface in existing hook/page/test entries and added a Task 8 ledger noting that Tasks 1-7 changed existing tracked files in place without adding or renaming tracked paths.
- Recorded the Task 8 documentation pass directly in this story file while working so the doc sync trail stays current rather than being reconstructed after validation.
- `npm run format:check --workspaces` passed cleanly; `npm run lint --workspaces` passed with the same existing server import-order warnings seen in prior tasks and no new Task 8 errors.
- `npm run test:summary:client` passed with 484/484 tests green, confirming the documentation-only changes did not disturb the previously completed Story 42 client regression matrix.
- `npm run compose:build:summary` passed with both compose build targets green, so the docs smoke check can run against the same front-end stack the story used for the earlier manual validations.
- `npm run compose:up` started the local stack cleanly with healthy server and client containers, making the required browser documentation smoke check available on the mapped host port.
- Manual docs smoke on `http://host.docker.internal:5001/flows` saved `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task8-docs-smoke-check.png`, confirmed the Flow GUI still shows a retained earlier transcript while a later step is active, verified the `projectStructure.md` paths referenced by Task 8 exist, and replayed browser-side WS events that emitted the shipped Story 42 markers (`chat.ws.client_assistant_delta_ignored`, `chat.ws.client_user_turn_ignored`, `chat.ws.client_non_final_ignored`, `chat.ws.client_turn_final_preserved`, `chat.ws.client_stale_event_ignored`, `flows.page.live_transcript_retained`) with no console errors; `flows.page.visibility_reset_guarded` remained intentionally absent because Task 7 stayed N/A.
- `npm run compose:down` stopped the local stack cleanly after the documentation smoke check and screenshot review were complete.

---

### 9. Final validation and acceptance check

- Task Status: `__done__`
- Git Commits:
  - `a181013b` - `DEV-[0000042] - Finalize streaming transcript acceptance handoff`

#### Overview

Perform the final acceptance pass for the story. This task must confirm the shared hook fix, the Flow page behavior, the non-regression coverage for Chat and Agents, and the updated documentation. It also produces the final screenshots and pull request summary comment for the completed story.

#### Documentation Locations

- Docker docs: https://docs.docker.com/
  - use this for the compose lifecycle and container validation steps in the final acceptance pass
- Playwright docs: https://playwright.dev/docs/intro
  - use this for the manual validation workflow and screenshot capture expectations in the final task
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface in the repo when interpreting the final automated client test run
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for interpreting the final automated client regression run results
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/
  - use this for writing the final acceptance notes and pull request summary comment

#### Subtasks

1. [x] Run the full relevant client regression wrappers without file filters.
   - Use `Testing` step 2 for this subtask.
   - Review after the Testing section command completes:
     - the wrapper summary in the terminal
     - the generated client log under `test-results/`
   - Purpose for this subtask:
     - this is the final automated proof that Chat, Agents, Flows, and shared hook tests still pass together after the targeted task-level work
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
2. [x] Confirm this story remained strictly front end, so server build, unit, and cucumber wrappers were not required for the final regression pass.
   - Files to inspect:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
     - the final git diff for the story
     - any changed files under `client/`, `design.md`, `projectStructure.md`, and `README.md`
   - Purpose for this subtask:
     - prove the final regression scope matches the actual changed surfaces, so omitting server wrappers is deliberate rather than accidental
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
3. [x] Verify the story acceptance criteria one by one against the implemented behavior and note the outcome in this story file.
   - Document name:
     - `0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Location:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Description:
     - add a short pass/fail note for each acceptance criterion and link it back to the test or task that proved it
   - Purpose:
     - leave a clear acceptance audit trail inside the story plan
   - Documentation for this subtask:
     - reread the `Acceptance Criteria` section in this story before marking any item complete
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - When this subtask is complete:
     - each acceptance criterion has a short pass/fail note mapped to the task or test that proved it
4. [x] Verify that websocket message shapes, REST payload shapes, and persistence storage shapes were not changed by this story.
   - Files to inspect:
     - `server/src/ws/types.ts`
     - `server/src/ws/sidebar.ts`
     - `server/src/mongo/repo.ts`
     - any shared websocket or conversation type files touched during implementation
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Required outcome:
     - confirm the fix stayed in client-side stream handling and tests unless an unavoidable shape change was explicitly documented and justified
     - record the result in this story file’s Implementation notes
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
5. [x] Update `design.md` again if the final implementation introduced any last-minute architecture or behavior changes not yet documented.
   - Document name:
     - `design.md`
   - Location:
     - repo root `design.md`
   - Description:
     - add any final architecture or behavior notes that were introduced after the earlier design-update tasks completed
   - Purpose:
     - ensure the final design documentation matches the shipped implementation and diagrams
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
     - Mermaid syntax: Context7 `/mermaid-js/mermaid`
6. [x] Update `projectStructure.md` again if the final implementation introduced any last-minute file changes not yet documented.
   - Document name:
     - `projectStructure.md`
   - Location:
     - repo root `projectStructure.md`
   - Description:
     - add any final file, rename, or structure changes introduced after the earlier project-structure update task completed
   - Purpose:
     - ensure the repo file map reflects the final merged state of the story
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
7. [x] Start the compose stack and perform a manual Playwright MCP check of a known multi-step Flow such as `flows/implement_next_plan.json`.
   - Files and paths to read before running:
     - `flows/implement_next_plan.json`
     - `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/`
   - Required screenshots:
     - `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-09-flow-before-fix-validation.png`
     - `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-09-flow-during-second-step.png`
     - `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-09-flow-after-completion.png`
   - Required visual checks:
     - earlier assistant bubble text remains visible while the next step streams
     - the currently active later step also shows its own streaming text
   - Documentation for this subtask:
     - Playwright docs: https://playwright.dev/docs/intro
   - Required console log checks:
     - `chat.ws.client_assistant_delta_ignored` appears when a stale earlier-step assistant delta is ignored
     - `chat.ws.client_user_turn_ignored` appears when a stale earlier-step `user_turn` replay is ignored
     - `chat.ws.client_non_final_ignored` appears for the stale non-final event types exercised during the run
     - `chat.ws.client_turn_final_preserved` appears if a late older final arrives while a newer inflight is active
     - `chat.ws.client_stale_event_ignored` appears if a lower-sequence same-inflight packet is blocked at websocket level
     - `flows.page.live_transcript_retained` appears when the next Flow step starts and the earlier bubble remains visible
     - `flows.page.visibility_reset_guarded` appears only if Task 7 was implemented and the page-level safeguard is exercised
   - Expected console outcome:
     - each log line appears only for the event it is meant to confirm
     - the payload values identify the conversation and inflight involved
     - no unexpected `error`-level console entries appear during the run
   - Screenshot review requirement:
     - inspect each saved screenshot and confirm the GUI matches the required visual checks above before marking this subtask complete
8. [x] Write a pull request summary comment covering:
   - root cause
   - files changed
   - tests run
   - residual risks if any
   - File to create/update:
     - `test-results/pr-comments/0000042-summary.md`
   - Source material to read before writing:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
     - `design.md`
     - `projectStructure.md`
     - the final git diff for the story
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - When this subtask is complete:
     - the summary mentions the root cause, the shared-hook-first fix, any Flow-page fallback work, and the exact validation that was run
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Run first so the final validation follows the repo tasking convention and proves the server still builds cleanly even though this story is primarily client-side. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log`.
2. [x] `npm run build:summary:client` - Mandatory because client behavior changed. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log`.
3. [x] `npm run compose:build:summary` - Required clean compose build check. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log`.
4. [x] `npm run compose:up`
5. [x] `npm run test:summary:server:unit` - Run in the final task even though server contracts are unchanged, so nearby server/unit behavior is still proven clean in the final handoff.
6. [x] `npm run test:summary:client` - Mandatory because client behavior changed. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
7. [x] `npm run test:summary:e2e` - Allow up to 10 minutes; if `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:e2e`.
8. [x] Manual Playwright-MCP check to confirm the story acceptance behavior, save the required screenshots into `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/`, inspect those screenshots to confirm the GUI matches the acceptance criteria, and verify the debug console shows the expected log lines from Tasks 1–7 with no unexpected `error`-level entries. Use http://host.docker.internal:5001 via the Playwright MCP tools. This folder is mapped in `docker-compose.local.yml`.
9. [x] `npm run compose:down`

#### Acceptance audit

- `PASS` Previously rendered Flow bubble text stays visible when later steps begin streaming.
  Proven by Task 6 plus Task 12 Flow regression coverage, and the renewed Task 12 screenshot `0000042-task12-flow-marker-after-retention.png` showing the first step still visible while the second step streams.
- `PASS` The fix applies to the shared client streaming path first, with `FlowsPage` limited to a secondary safeguard only if needed.
  Proven by Tasks 1-5 landing in `useChatStream`/`useChatWs`, and Task 7 closing N/A without a Flow-page hardening change.
- `PASS` Stale or mismatched non-final websocket events do not mutate the active assistant bubble for a different inflight.
  Proven by Tasks 1-3 plus Task 12’s new finalized-replay regressions, and the renewed Task 12 manual markers `chat.ws.client_assistant_delta_ignored`, `chat.ws.client_non_final_ignored`, and `chat.ws.client_stale_event_ignored`.
- `PASS` Stale or mismatched `user_turn` websocket events do not reset or rebind the active assistant bubble during Flow-style idle streaming.
  Proven by Task 2 regressions, Task 10's finalized-replay regressions, and the renewed Task 11 manual marker `chat.ws.client_user_turn_ignored`.
- `PASS` Existing late/out-of-band `turn_final` handling remains non-destructive.
  Proven by Task 4 plus Task 12’s duplicate-final replay regression, and the renewed Task 12 manual marker `chat.ws.client_turn_final_preserved`.
- `PASS` Chat and Agents streaming behavior does not regress.
  Proven by Task 2, Task 4, and Task 12 shared-consumer regressions, plus the renewed full client wrapper run (`497/497` passed in `test-results/client-tests-2026-03-07T23-02-45-465Z.log`).
- `PASS` Regression coverage was added for the exact failure class listed in the story.
  Proven by Tasks 1-6 plus Task 12 across `useChatStream.inflightMismatch.test.tsx`, `useChatWs.test.ts`, `chatPage.stream.test.tsx`, `agentsPage.streaming.test.tsx`, and `flowsPage.run.test.tsx`.
- `PASS` API contracts, websocket schema, and persistence/Mongo shapes remain unchanged.
  Proven by the renewed Task 12 inspection of `server/src/ws/types.ts`, `server/src/ws/sidebar.ts`, and `server/src/mongo/repo.ts`, plus the clean server unit wrapper rerun (`979/979` passed in `test-results/server-unit-tests-2026-03-07T22-52-06-559Z.log`).
- `PASS` The plan documents the root cause, likely files, minimum regressions, and the primary-vs-secondary fix split clearly enough for follow-on work.
  Proven by the updated story file itself, `design.md`, `README.md`, and `projectStructure.md` after Task 8 and the Task 12 replay/retention documentation refresh.

#### Implementation notes

- Final story diff inspection shows the implementation stayed on client hooks/pages/tests plus README/design/projectStructure/story docs; no server source, shared contract, or persistence files were changed even though Task 9 still requires final server wrapper checks.
- Verified `server/src/ws/types.ts`, `server/src/ws/sidebar.ts`, and `server/src/mongo/repo.ts` remain untouched in the story diff, so websocket message shapes, sidebar payload shapes, and Mongo storage shapes did not change.
- Rechecked `design.md` and `projectStructure.md` after Task 8; no last-minute architecture or file-map changes were needed before the final validation pass.
- `npm run build:summary:server` passed with zero warnings, satisfying the final-task wrapper requirement without changing the earlier conclusion that the story itself stayed client/docs-focused.
- `npm run build:summary:client` passed; `logs/test-summaries/build-client-latest.log` still only shows the pre-existing Vite chunk-size warning and no new Task 9 build regression.
- `npm run compose:build:summary` passed with both compose build targets green, so the final manual and automated validation can run against a clean rebuilt stack.
- `npm run compose:up` brought the final-validation stack up cleanly with healthy server and client containers on the mapped host ports required for the wrapper suite and Playwright MCP checks.
- `npm run test:summary:server:unit` passed with 979/979 tests green, satisfying the final-task wrapper requirement while preserving the conclusion that no server contract or persistence code changed in this story.
- `npm run test:summary:client` passed with 484/484 tests green; this is the final unfiltered client regression proof that Chat, Agents, Flows, and the shared hook/websocket protections still pass together.
- `npm run test:summary:e2e` passed with 42/42 tests green, so the final acceptance handoff includes the repo’s full browser-level wrapper check in addition to the targeted client regression coverage.
- Final manual Flow validation used `http://host.docker.internal:5001/flows`, read `flows/implement_next_plan.json` as the multi-step reference flow, and replayed a controlled two-step websocket sequence on a live Flow page session so the required screenshots could prove the exact acceptance behavior.
- Saved and reviewed `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-09-flow-before-fix-validation.png`, `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-09-flow-during-second-step.png`, and `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-09-flow-after-completion.png`; they show the first assistant bubble staying visible, the second step streaming while the first remains visible, and both steps completing without transcript loss.
- Queried `/logs` for the manual run context (`conversationId: zkrfeslapsp`) and confirmed the expected shipped Story 42 markers: `chat.ws.client_assistant_delta_ignored`, `chat.ws.client_user_turn_ignored`, `chat.ws.client_non_final_ignored`, `chat.ws.client_turn_final_preserved`, `chat.ws.client_stale_event_ignored`, and `flows.page.live_transcript_retained`; `flows.page.visibility_reset_guarded` remained absent as expected because Task 7 stayed N/A, and browser console error output stayed empty.
- Added an explicit Acceptance audit section that maps every story acceptance criterion to the task, test, wrapper, or manual screenshot/log evidence that proved it passed.
- Wrote `test-results/pr-comments/0000042-summary.md` covering the root cause, shared-hook-first fix, files changed, wrappers/manual checks run, and the residual risk around the intentionally unneeded Task 7 safeguard.
- `npm run format:check --workspaces` passed cleanly; `npm run lint --workspaces` again only reported the existing server import-order warnings and no new Task 9 issues after the final story-file and PR-summary edits.
- `npm run compose:down` stopped the final-validation stack cleanly after the wrapper suite, manual screenshots, `/logs` verification, and documentation closeout finished.

## Post-Implementation Review

- Review baseline:
  - Compared this branch against `main` using `git diff main...HEAD`, `git diff --stat main...HEAD`, and `git log --oneline main..HEAD` to confirm the changed surfaces before reviewing code and plan evidence.
- High-risk code paths reviewed:
  - `client/src/hooks/useChatStream.ts`
  - `client/src/hooks/useChatWs.ts`
  - `client/src/pages/FlowsPage.tsx`
  - `client/src/test/useChatStream.inflightMismatch.test.tsx`
  - `client/src/test/useChatWs.test.ts`
  - `client/src/test/chatPage.stream.test.tsx`
  - `client/src/test/agentsPage.streaming.test.tsx`
  - `client/src/test/flowsPage.run.test.tsx`
- Acceptance checks reviewed:
  - verified the shared-hook-first fix split remained intact and that Task 7 correctly stayed N/A
  - verified the plan’s final Acceptance audit maps each acceptance criterion to explicit automated or manual evidence
  - verified the final screenshots and PR summary file referenced by Task 9 exist in the branch
  - verified the final task recorded clean wrapper outcomes for server build, client build, compose build, server unit tests, client tests, and e2e
  - verified the story’s own final diff audit still shows no intended websocket contract, REST payload, or persistence-shape changes for this story
- Review outcome:
  - one follow-up code-review finding was identified: finalized older-inflight `user_turn` replays can bypass the stale-replay guard after `turn_final` deletes the assistant-message mapping used by the current detection
  - Tasks 10 and 11 were added to fix that gap and force a fresh full acceptance pass before this story is treated as complete again

---

### 10. Shared hook safeguard: finalized-inflight `user_turn` replays must stay ignored after `turn_final`

- Task Status: `__done__`
- Git Commits:
  - `ee878917` - `DEV-[0000042] - Keep finalized stale user_turn replays ignored`
  - `92732ae7` - `DEV-[0000042] - Record Task 10 implementation commit`

#### Overview

Close the stale-replay gap identified in review: `user_turn` replay detection currently depends on `assistantMessageIdByInflightIdRef`, but the `turn_final` path deletes that mapping for the finalized inflight. This task must preserve the existing stale-replay behavior even after an older inflight has already finalized, without widening scope into new transport logic or page-specific workarounds.

#### Documentation Locations

- React 19.2 `useRef`: https://react.dev/reference/react/useRef
  - use this for the long-lived per-conversation mutable state needed to remember seen inflight IDs without forcing extra renders
- React 19.2 state snapshots: https://react.dev/learn/state-as-a-snapshot
  - use this for reasoning about why the stale-replay guard must rely on explicit refs rather than transient render state
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for the current Jest 30 API surface when extending the hook regression suite
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for the current client test runner structure and assertion model
- React Testing Library (`@testing-library/react` 16.x): https://testing-library.com/docs/react-testing-library/intro/
  - use this for `renderHook`, `act`, and `waitFor` patterns used by the shared-hook regressions
- WebSocket browser API: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
  - use this for reasoning about why the hook must still defend against stale transcript events that reach it after transport-level filtering
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` if the inflight-lifecycle diagrams need to describe the finalized-inflight replay rule

#### Subtasks

1. [x] Read the existing `user_turn` stale-replay guard and the `turn_final` cleanup path before changing code.
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Start here in code:
     - the `staleInflightReplay` calculation in the `user_turn` branch
     - the `assistantMessageIdByInflightIdRef.current.delete(event.inflightId)` line in the `turn_final` branch
   - Goal:
     - identify exactly why a finalized older inflight can lose its stale-replay marker before a later replayed `user_turn` arrives
2. [x] Update `client/src/hooks/useChatStream.ts` so stale older-inflight `user_turn` replays stay ignored even after `turn_final` has cleaned up assistant-message mappings.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - add the smallest possible shared-hook state needed to remember that an inflight has already been seen for the current conversation
     - clear or reset that state only where conversation-local streaming state is intentionally reset (for example conversation changes or full reset paths)
   - Required behavior:
     - a stale `user_turn` replay for an older inflight must still emit the existing ignore log and return without resetting the assistant pointer, even if that older inflight has already finalized
     - a legitimate unseen next inflight must still be allowed to create the next assistant bubble after the previous inflight finalizes
     - do not move sequence filtering out of `useChatWs`
     - do not add page-specific fallback logic for this hook-level concern
3. [x] Keep the existing `chat.ws.client_user_turn_ignored` logging behavior intact for finalized older-inflight replays.
   - Files to edit only if required:
     - `client/src/hooks/useChatStream.ts`
   - Required outcome:
     - a finalized older-inflight replay still emits `chat.ws.client_user_turn_ignored` with `reason: 'stale_inflight'`
     - no new log name should be introduced for this fix
4. [x] Add a hook regression test that replays `user_turn` for an older inflight after that older inflight already received `turn_final`, then asserts the newer active bubble stays intact.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Required assertions:
     - the older finalized bubble keeps its existing text/status
     - the newer active inflight remains the active target
     - no duplicate assistant bubble is created for the replayed older inflight
5. [x] Add a separate hook regression test that proves a legitimate unseen next inflight still advances normally after a previous inflight finalizes.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Required assertions:
     - after the first inflight finalizes, a brand-new inflight can still create the next assistant bubble
     - the new bubble still accepts matching deltas and finalization normally
6. [x] Re-run nearby shared-consumer regressions that exercise late finals and streaming ownership.
   - Files to read/edit only if failures require updates:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
     - `client/src/test/flowsPage.run.test.tsx`
7. [x] Update `design.md` with the finalized-inflight replay rule if the implementation changes how the story describes stale `user_turn` ownership after `turn_final`.
   - Files to edit:
     - `design.md`
   - Required content:
     - document that stale `user_turn` replay detection survives `turn_final` cleanup for the current conversation
8. [x] Update this story file’s Implementation notes for Task 10 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save a screenshot to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task10-finalized-user-turn-replay-ignored.png`, review that screenshot to confirm a finalized older-step replay does not steal the active bubble, and confirm the debug console contains `chat.ws.client_user_turn_ignored` with `reason: 'stale_inflight'` and no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
6. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Re-read the `user_turn` stale-replay guard and `turn_final` cleanup path in `useChatStream`; confirmed the current replay detection depends on `assistantMessageIdByInflightIdRef`, so deleting that mapping on finalization removes the stale marker for an older inflight.
- Subtask 2: Added a minimal per-conversation seen-inflight ref in `useChatStream` so finalized older inflights stay marked as seen even after `turn_final` removes their assistant-message mapping; the ref is cleared only on conversation resets and conversation changes.
- Subtask 3: Kept the existing `chat.ws.client_user_turn_ignored` log path and payload intact; the finalized older-inflight replay fix reuses the same marker instead of introducing a new log name.
- Subtask 4: Added a hook regression that finalizes the first inflight, starts a second inflight, then replays the first inflight’s `user_turn` and proves the newer active bubble stays intact with no duplicate assistant bubble.
- Subtask 5: Added a separate hook regression proving a legitimate unseen next inflight still creates, streams, and finalizes its own assistant bubble after the previous inflight completes.
- Subtask 6: Re-ran the nearby Chat, Agents, and Flows shared-consumer regressions with targeted client wrappers; all three suites stayed green after the finalized-replay safeguard was added.
- Subtask 7: Updated `design.md` so the user-turn ownership rule now states that seen-inflight replay detection survives `turn_final` cleanup and still ignores finalized older-inflight replays.
- Subtask 8: Recorded the Task 10 implementation and validation trail here after the focused hook fix, consumer regressions, wrapper pass, and manual browser replay completed.
- Subtask 9: `npm run lint --workspaces` completed with the same existing server import-order warnings and no Task 10 errors; `npm run format:check --workspaces` passed cleanly.
- Testing 1: `npm run build:summary:client` passed; inspected `logs/test-summaries/build-client-latest.log` and the only warning remained the existing Vite chunk-size warning rather than a Task 10 regression.
- Testing 2: `npm run test:summary:client` passed with 486/486 tests green; the final full wrapper log was `test-results/client-tests-2026-03-07T19-39-18-793Z.log`.
- Testing 3: `npm run compose:build:summary` passed with both compose build items green; no compose build follow-up was needed.
- Testing 4: `npm run compose:up` started the stack successfully; the server reached healthy state and the client started for the required manual verification.
- Testing 5: Manual browser validation targeted `http://host.docker.internal:5001/chat`, saved `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task10-finalized-user-turn-replay-ignored.png`, showed the newer `Second reply` bubble staying active during the finalized older-inflight replay, and captured one `chat.ws.client_user_turn_ignored` marker with no console errors.
- Testing 6: `npm run compose:down` stopped the stack cleanly after the Task 10 manual verification pass.

---

### 11. Final re-validation and acceptance re-check

- Task Status: `__done__`
- Git Commits:
  - `43ade902` `DEV-[0000042] - Revalidate final transcript handoff`

#### Overview

Re-run the full story acceptance pass after Task 10 so the branch proves the finalized-inflight replay fix did not introduce regressions elsewhere. This task is a fresh final handoff and should treat the story as needing full acceptance evidence again, not as a partial smoke check.

#### Documentation Locations

- Docker docs: https://docs.docker.com/
  - use this for the compose lifecycle and container validation steps in the final re-check
- Playwright docs: https://playwright.dev/docs/intro
  - use this for the manual validation workflow and screenshot capture expectations
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for interpreting the final automated client test run
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for interpreting the final automated regression results
- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/
  - use this for updating the acceptance audit and PR summary comment

#### Subtasks

1. [x] Re-run the full relevant client regression wrappers without file filters.
   - Use `Testing` step 6 for this subtask.
   - Purpose:
     - prove the finalized-inflight replay fix did not regress Chat, Agents, Flows, or the shared hook/websocket protections
2. [x] Re-check the story acceptance criteria one by one and update the `Acceptance audit` section in this story file with any new evidence needed from Task 10.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Required outcome:
     - each acceptance criterion still has a clear pass note tied to current evidence after Task 10
3. [x] Re-confirm that websocket message shapes, REST payload shapes, and persistence storage shapes remain unchanged after Task 10.
   - Files to inspect:
     - `server/src/ws/types.ts`
     - `server/src/ws/sidebar.ts`
     - `server/src/mongo/repo.ts`
     - any shared websocket or conversation type files touched by Task 10
4. [x] Update `design.md` and `projectStructure.md` again if Task 10 introduced any last-minute architecture or file-map changes not yet documented.
   - Files to edit only if required:
     - `design.md`
     - `projectStructure.md`
5. [x] Start the compose stack and perform a fresh manual Playwright MCP check of a known multi-step Flow such as `flows/implement_next_plan.json`.
   - Required screenshots:
     - `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-11-flow-before-revalidation.png`
     - `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-11-flow-during-revalidation.png`
     - `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-11-flow-after-revalidation.png`
   - Required checks:
     - earlier assistant bubble text remains visible while the next step streams
     - finalized older-step `user_turn` replays do not steal the active bubble
     - expected Story 42 log markers still appear with no unexpected `error`-level console entries
6. [x] Update `test-results/pr-comments/0000042-summary.md` so it includes the Task 10 fix, the renewed validation run, and any updated residual risk statement.
7. [x] Update this story file’s Implementation notes for Task 11 once the full re-validation is complete.
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Run first so the re-validation follows the repo tasking convention and proves the server still builds cleanly.
2. [x] `npm run build:summary:client` - Mandatory because client behavior changes in Task 10.
3. [x] `npm run compose:build:summary` - Required clean compose build check.
4. [x] `npm run compose:up`
5. [x] `npm run test:summary:server:unit` - Re-run even though server contracts are still expected to remain unchanged.
6. [x] `npm run test:summary:client` - Mandatory because Task 10 changes client behavior.
7. [x] `npm run test:summary:e2e` - Run the full browser-level wrapper suite again for the renewed handoff.
8. [x] Manual Playwright-MCP check to confirm the story acceptance behavior, save the required screenshots into `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/`, inspect those screenshots to confirm the GUI matches the acceptance criteria, and verify the debug console shows the expected log lines from Tasks 1–10 with no unexpected `error`-level entries. Use http://host.docker.internal:5001 via the Playwright MCP tools.
9. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Re-ran the full unfiltered client wrapper after Task 10; Chat, Agents, Flows, and the shared hook/websocket regression set all stayed green together.
- Subtask 3: Re-checked `server/src/ws/types.ts`, `server/src/ws/sidebar.ts`, and `server/src/mongo/repo.ts` against the post-Task-10 diff; websocket message shapes, REST/sidebar payloads, and persistence storage shapes remain unchanged.
- Subtask 4: Re-audited `design.md` and `projectStructure.md` after Task 10; no additional architecture or file-map edits were needed beyond the Task 10 design note that was already committed.
- Subtask 2: Refreshed the story Acceptance audit with the post-Task-10 evidence trail so each acceptance criterion now points at the renewed Task 11 wrappers, manual screenshots, or finalized-replay regression coverage instead of the superseded Task 9 handoff.
- Subtask 5: Replayed a controlled two-step Flow session on `http://host.docker.internal:5001/flows`, saved the three Task 11 screenshots, and verified that the first assistant bubble stayed visible while the second step streamed and while a finalized older-step replay was ignored.
- Subtask 6: Recreated `test-results/pr-comments/0000042-summary.md` with the Task 10 finalized-replay fix, the renewed Task 11 wrapper/manual validation run, and the residual-risk note that Task 7 still intentionally remains N/A.
- Subtask 7: Recorded the final Task 11 evidence here after the renewed acceptance audit, manual Flow replay, wrapper shutdown, and repo hygiene checks completed.
- Subtask 8: `npm run lint --workspaces` repeated the same existing server import-order warnings and no new Task 11 issues; `npm run format:check --workspaces` passed cleanly across all workspaces.
- Testing 1: `npm run build:summary:server` passed with zero warnings; `logs/test-summaries/build-server-latest.log` did not require follow-up.
- Testing 2: `npm run build:summary:client` passed; inspected `logs/test-summaries/build-client-latest.log` and the only warning remained the existing Vite chunk-size warning rather than a Task 11 regression.
- Testing 3: `npm run compose:build:summary` passed with both compose build items green; no compose build diagnosis was needed.
- Testing 4: `npm run compose:up` started the stack successfully; the server reached healthy state and the client started for the renewed validation pass.
- Testing 5: `npm run test:summary:server:unit` passed with 979/979 tests green; the full wrapper log was `test-results/server-unit-tests-2026-03-07T19-46-35-462Z.log`.
- Testing 6: `npm run test:summary:client` passed with 486/486 tests green; the full wrapper log was `test-results/client-tests-2026-03-07T19-56-40-723Z.log`.
- Testing 7: `npm run test:summary:e2e` passed with 39/39 tests green; the wrapper log was `logs/test-summaries/e2e-tests-latest.log`.
- Testing 8: The renewed manual Flow replay saved `0000042-11-flow-before-revalidation.png`, `0000042-11-flow-during-revalidation.png`, and `0000042-11-flow-after-revalidation.png`; the page retained the first assistant transcript while the second step streamed, ignored the finalized older-step replay, emitted all required Story 42 markers, and produced no console/page errors.
- Testing 9: `npm run compose:down` stopped the validation stack cleanly after the final screenshots and marker checks were complete.

## Post-Implementation Review

- Review date: 2026-03-07
- Review scope: compared `feature/0000042-flow-streaming-transcript-loss` against `main`, with focused inspection of the Story 42 implementation surface in `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`, `client/src/pages/FlowsPage.tsx`, related client regression tests, `design.md`, `projectStructure.md`, and this story plan.
- Branch comparison checked:
  - `git diff --stat main...HEAD`
  - `git diff --name-only main...HEAD`
  - targeted diffs for the shared streaming hook, websocket filtering hook, Flow page, and Story 42 regression suites
- Acceptance review checked:
  - previously rendered assistant text stays visible while later Flow steps stream
  - stale or mismatched `assistant_delta`, `analysis_delta`, `tool_event`, `stream_warning`, and `user_turn` events are ignored before mutating the active inflight
  - lower-sequence same-inflight websocket packets are blocked in `useChatWs`
  - late `turn_final` handling remains non-destructive
  - Chat and Agents coverage still exercises the shared hook behavior after the Flow fix
  - websocket contracts, REST payloads, and persistence shapes remained unchanged for the story
- Review outcome:
  - no additional follow-up defects were identified that required reopening the story
  - no extra remediation tasks were added

## Review Comment Follow-up

- Follow-up date: 2026-03-07
- Scope:
  - tightened the stale `inflight_snapshot` guard in `client/src/hooks/useChatStream.ts` so finalized older-inflight snapshot replays are ignored based on conversation-local seen inflight ids rather than the assistant-message mapping that `turn_final` clears
  - tightened the `fallbackFetch` typing in `client/src/test/support/mockChatWs.ts` to require `Response | Promise<Response>` and normalized fallback returns with `Promise.resolve(...)`
- Added regression coverage in `client/src/test/useChatStream.inflightMismatch.test.tsx` for:
  - replayed `inflight_snapshot` after `turn_final` on an older inflight while a newer inflight is active
  - current-inflight snapshot hydration still working after a previous inflight finalized
- Validation rerun:
  - `npm run build:summary:client` passed with the existing Vite chunk-size warning only
  - `npm run test:summary:client` passed with 488/488 tests green in `test-results/client-tests-2026-03-07T21-12-25-423Z.log`
  - `npm run lint --workspaces` completed with the same pre-existing server import-order warnings and no new errors
  - `npm run format:check --workspaces` passed after formatting `client/src/test/support/mockChatWs.ts`

## Review Comment Follow-up 2

- Follow-up date: 2026-03-07
- Scope:
  - preserved inflight ownership state during same-conversation `hydrateHistory(...)` refreshes so active processing bubbles keep their assistant-message mapping and seen-inflight memory
  - prevented duplicate same-inflight `hydrateInflightSnapshot(...)` replays from creating extra assistant bubbles, while still allowing legitimate current inflight snapshot hydration
  - stopped `FlowsPage` live-transcript marker bookkeeping from moving `lastFlowInflightIdRef` backward on stale replays so later step-transition logs keep the correct previous inflight
- Added regression coverage in:
  - `client/src/test/useChatStream.inflightMismatch.test.tsx` for duplicate snapshot hydration and same-conversation history refresh during an active inflight
  - `client/src/test/flowsPage.run.test.tsx` for stale replay logging not corrupting the next real flow-step transition marker
- Validation rerun:
  - `npm run build:summary:client` passed with the same existing Vite chunk-size warning only
  - `npm run test:summary:client` passed with 491/491 tests green in `test-results/client-tests-2026-03-07T21-44-50-466Z.log`
  - `npm run test:summary:server:unit` passed with 979/979 tests green in `test-results/server-unit-tests-2026-03-07T21-40-09-548Z.log`
  - `npm run test:summary:server:cucumber` passed with 68/68 tests green in `test-results/server-cucumber-tests-2026-03-07T21-40-09-541Z.log`
  - `npm run test:summary:e2e` passed with 42/42 tests green in `logs/test-summaries/e2e-tests-latest.log`
  - `npm run lint --workspaces` completed with the same pre-existing server import-order warnings and no new errors
  - `npm run format:check --workspaces` passed cleanly

---

### 12. Finalized-inflight replay hardening, Flow validation marker proof, and Task 7 bookkeeping cleanup

- Task Status: `__done__`
- Git Commits:
  - `fdbed4e4` - `DEV-[0000042] - Harden post-final transcript replays`

#### Overview

A later branch review identified three remaining holes that still need explicit follow-up before Story 42 can be treated as fully closed:

- replayed same-inflight transcript packets received after `turn_final` can still create a phantom assistant bubble because the assistant-message mapping was already deleted
- the shipped `flows.page.live_transcript_retained` marker is currently logged too early to serve as strong proof that the earlier bubble actually remained visible after the next step was applied
- Task 7 was correctly closed as not applicable, but its unchecked conditional subtasks/testing steps still leave this story looking like the next active todo plan

This task keeps the scope narrow:

- harden the shared hook against post-final same-inflight replays
- strengthen the Flow-page retention marker so it reflects post-event UI truth rather than pre-event state
- fix the plan bookkeeping so conditional N/A work no longer leaves the story falsely open

Do not widen this task into contract/schema changes, Flow-only stream ownership logic, or unrelated sidebar refactors.

#### Documentation Locations

- React 19.2 effect synchronization: https://react.dev/learn/synchronizing-with-effects
  - use this for reasoning about late async updates that should be ignored once a rendered unit of work has already been finalized
- Jest 30 docs: Context7 `/websites/jestjs_io_30_0`
  - use this for current test APIs in the repo when adding the separate replay regressions
- Jest 30 getting started: https://jestjs.io/docs/getting-started
  - use this for the targeted regression workflow and wrapper interpretation
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
  - use this for the hook and Flow page assertions required by this task
- Testing Library user-event: https://testing-library.com/docs/user-event/intro/
  - use this if the Flow page regression needs explicit page interaction around the retained-transcript proof
- Playwright docs: https://playwright.dev/docs/intro
  - use this for the manual browser replay and screenshot verification steps
- MUI 6.x docs reference for current `FlowsPage` component patterns:
  - MUI MCP `@mui/material@6.4.12`
  - use this because any Flow-page marker change must preserve the existing MUI 6.x page structure and behavior
- Mermaid docs: Context7 `/mermaid-js/mermaid`
  - use this when updating `design.md` diagrams for any finalized-replay or Flow-marker behavior changes

#### Subtasks

1. [x] Re-read the current post-final replay paths, Flow retention marker logic, and Task 7 closeout bookkeeping before editing.
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/FlowsPage.tsx`
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
     - `client/src/test/flowsPage.run.test.tsx`
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Required outcome:
     - identify the exact places where post-final same-inflight packets can still create a new assistant bubble
     - identify why `flows.page.live_transcript_retained` currently reflects pre-event visibility rather than post-event retention
     - identify the exact Task 7 boxes that must be normalized once this task lands
2. [x] Update `client/src/hooks/useChatStream.ts` so post-final same-inflight transcript replays are ignored instead of creating a new bubble or reopening a finalized one.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Start here in code:
     - the `turn_final` branch inside `handleWsEvent`
     - the helper path that resolves or creates assistant bubbles for transcript events
   - Required behavior:
     - replayed same-inflight `assistant_delta`, `analysis_delta`, `tool_event`, `stream_warning`, `inflight_snapshot`, and duplicate `turn_final` packets received after finalization must not create a new assistant bubble
     - the already-finalized assistant bubble must keep its existing text/status/metadata
     - legitimate unseen next inflights must still create their own assistant bubble normally after a previous inflight finalizes
     - do not move sequence filtering out of `useChatWs`
     - do not introduce Flow-only fallback logic for this shared-hook concern
3. [x] Keep logging coherent for ignored finalized-inflight replays without weakening the existing Story 42 markers.
   - Files to edit only if required:
     - `client/src/hooks/useChatStream.ts`
     - `design.md`
   - Required outcome:
     - ignored finalized-inflight replays either reuse the existing ignore markers with a clear reason payload or introduce the smallest possible additional marker if reuse is not sufficient
     - the final design docs explain how post-final replay ignore behavior differs from stale cross-inflight ignore behavior
4. [x] Add a separate hook regression test for replayed same-inflight `assistant_delta` after `turn_final`.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Required assertions:
     - the finalized assistant bubble keeps its existing content/status
     - no duplicate assistant bubble is created
     - the replayed delta does not reopen the finalized bubble
5. [x] Add a separate hook regression test for replayed same-inflight `analysis_delta` after `turn_final`.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Required assertions:
     - finalized reasoning state does not change
     - no duplicate assistant bubble is created
     - the finalized bubble does not return to `processing`
6. [x] Add a separate hook regression test for replayed same-inflight `tool_event` after `turn_final`.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Required assertions:
     - finalized tool state does not change
     - no duplicate assistant bubble is created
     - no new processing bubble appears for the replayed tool event
7. [x] Add a separate hook regression test for replayed same-inflight `stream_warning` after `turn_final`.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Required assertions:
     - finalized warning state does not change unexpectedly
     - no duplicate assistant bubble is created
     - the finalized bubble remains finalized
8. [x] Add a separate hook regression test for replayed same-inflight `inflight_snapshot` after `turn_final`.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Required assertions:
     - the finalized assistant bubble keeps its existing text/reasoning/tool state
     - no duplicate assistant bubble is created
     - the replayed snapshot does not put the finalized bubble back into `processing`
9. [x] Add a separate hook regression test for duplicate same-inflight `turn_final` replay after finalization.
   - Test type:
     - hook regression test
   - Location:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
   - Required assertions:
     - the finalized bubble remains singular and finalized
     - duplicate finalization does not create a new bubble
     - previously finalized metadata stays intact
10. [x] Re-run nearby shared-consumer regressions that exercise late-final and transcript-ownership behavior.

- Files to read/edit only if failures require updates:
  - `client/src/test/chatPage.stream.test.tsx`
  - `client/src/test/agentsPage.streaming.test.tsx`
  - `client/src/test/flowsPage.run.test.tsx`
- Required outcome:
  - the shared hook hardening does not regress Chat, Agents, or the Flow happy path

11. [x] Update `client/src/pages/FlowsPage.tsx` so `flows.page.live_transcript_retained` is emitted only after the page has enough post-event state to prove the earlier transcript actually remained visible through the next-step transition.

- Files to edit:
  - `client/src/pages/FlowsPage.tsx`
- Constraint:
  - keep this change limited to marker correctness/evidence strength
  - do not convert this into Flow-only stream ownership logic
  - do not widen scope into unrelated `flowConversations` reset hardening from Task 7
- Required outcome:
  - the marker is tied to retained post-event UI state rather than only to pre-event visibility plus a new inflight id

12. [x] Add or update a separate Flow page regression proving the strengthened `flows.page.live_transcript_retained` marker only fires when the earlier bubble remains visible after the next step is applied.

- Test type:
  - page integration regression test
- Location:
  - `client/src/test/flowsPage.run.test.tsx`
- Required assertions:
  - the earlier Flow bubble is still visible after the next step transition that emits the marker
  - stale replay-only transitions do not move the marker bookkeeping backward
  - the test proves the marker now reflects post-event transcript retention rather than a pre-event guess

13. [x] Normalize Task 7 N/A bookkeeping in this story file so conditional subtasks/testing steps no longer leave Story 42 falsely looking like the next active todo plan.

- Files to edit:
  - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
- Required outcome:
  - Task 7 still clearly records that no Flow-page hardening was required
  - conditional Task 7 boxes are normalized so the plan no longer appears unfinished solely because that task was N/A
  - the story remains active only because of Task 12 until this new work is complete

14. [x] Update `design.md`, `projectStructure.md`, and the `Acceptance audit` section in this story file if Task 12 changes the documented replay-ignore rules, Flow marker semantics, or story closeout bookkeeping.

- Files to edit:
  - `design.md`
  - `projectStructure.md`
  - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
- Required content:
  - document the final post-final replay ignore rule distinctly from stale cross-inflight ignores
  - document the strengthened Flow retention marker semantics
  - update the Acceptance audit evidence trail if Task 12 changes which markers/manual checks are still considered valid proof

15. [x] Update this story file’s Implementation notes for Task 12 once the code and tests are complete.

- Files to edit:
  - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`

16. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Re-run because this task changes the final story plan/acceptance closeout and the full revalidation should follow the repo’s wrapper-first handoff convention.
2. [x] `npm run build:summary:client` - Required because Task 12 changes client hook and Flow page behavior.
3. [x] `npm run compose:build:summary` - Required clean compose build re-check before browser validation.
4. [x] `npm run compose:up`
5. [x] `npm run test:summary:server:unit` - Re-run to preserve the full story-wide validation matrix even though the expected code changes remain client-focused.
6. [x] `npm run test:summary:server:cucumber` - Re-run because Task 12 is intended to be the final story-closeout pass and should repeat the full wrapper suite.
7. [x] `npm run test:summary:client` - Mandatory because Task 12 adds new client regression coverage and changes shared client behavior.
8. [x] `npm run test:summary:e2e` - Re-run the full browser-level wrapper suite again for the renewed final handoff.
9. [x] Manual Playwright-MCP check at http://host.docker.internal:5001. Save screenshots to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task12-post-final-replay-hardened.png` and `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000042-task12-flow-marker-after-retention.png`, review those screenshots to confirm no phantom bubble appears after a post-final same-inflight replay and that the earlier Flow bubble remains visible at the point where the strengthened retention marker is emitted, and confirm the debug console contains the expected final Story 42 replay/retention markers with no unexpected console errors. This folder is mapped in `docker-compose.local.yml`.
10. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Re-read `useChatStream`, `FlowsPage`, the mismatch and Flow run regressions, and the Task 7/Task 12 plan sections; confirmed the post-final replay gap is caused by `turn_final` deleting the inflight-to-assistant mapping before later same-inflight transcript packets are checked, `flows.page.live_transcript_retained` is currently emitted before post-event UI truth exists, and Task 7 still has unchecked conditional boxes in both its Subtasks and Testing sections even though the task closed N/A.
- Subtask 2: Added a conversation-local finalized-inflight guard in `useChatStream` so replayed same-inflight `assistant_delta`, `analysis_delta`, `tool_event`, `stream_warning`, `inflight_snapshot`, and duplicate `turn_final` packets return before `ensureAssistantMessage(...)` can create a phantom post-final bubble; legitimate new inflights still clear the finalized marker for their own id and proceed normally.
- Subtask 3: Reused the shipped Story 42 log names instead of inventing a parallel marker set; finalized-inflight replays now emit the existing ignore markers with `reason: 'finalized_inflight_replay'`, and the design notes now distinguish that case from stale cross-inflight ignores.
- Subtask 4: Added a hook regression proving a replayed same-inflight `assistant_delta` after `turn_final` leaves the finalized bubble singular, complete, and text-stable.
- Subtask 5: Added a hook regression proving a replayed same-inflight `analysis_delta` after `turn_final` does not change finalized reasoning state or return the bubble to `processing`.
- Subtask 6: Added a hook regression proving a replayed same-inflight `tool_event` after `turn_final` does not mutate finalized tool state or create a new bubble.
- Subtask 7: Added a hook regression proving a replayed same-inflight `stream_warning` after `turn_final` does not change finalized warnings or reopen the bubble.
- Subtask 8: Added a hook regression proving a replayed same-inflight `inflight_snapshot` after `turn_final` cannot overwrite finalized text/reasoning/tools or recreate a processing bubble.
- Subtask 9: Added a hook regression proving a duplicate same-inflight `turn_final` replay after finalization is a no-op that preserves the original finalized metadata.
- Subtask 10: Re-ran the nearby Chat, Agents, and Flows shared-consumer regressions with targeted client wrappers; all stayed green after the finalized-replay hardening.
- Subtask 11: Reworked `FlowsPage` retention-marker timing from a pre-event log to a queued post-event proof check so `flows.page.live_transcript_retained` only emits after the page still shows the earlier bubble through the next-step transition.
- Subtask 12: Updated the Flow run regression so it proves the retention marker does not fire before the next step becomes visibly real and still records the correct step-to-step transition with the new `proof: 'post_event_transcript_visible'` payload.
- Subtask 13: Normalized the Task 7 conditional N/A checkboxes in both Subtasks and Testing so Story 42 no longer appears unfinished solely because that task intentionally required no page-local hardening.
- Testing 1: `npm run build:summary:server` passed with zero warnings, so the final closeout pass still follows the repo’s full wrapper convention even though the code changes remained client/docs-focused.
- Testing 2: `npm run build:summary:client` passed; inspected `logs/test-summaries/build-client-latest.log` because the wrapper reported one warning, and it remained the same pre-existing Vite chunk-size warning rather than a Task 12 regression.
- Testing 3: `npm run compose:build:summary` passed with both compose build items green, so the final validation can run against a fresh rebuilt stack without opening the full compose log.
- Testing 4: `npm run compose:up` started the stack successfully; Mongo, server, and client all reached started/healthy state for the remaining wrapper and Playwright validation steps.
- Testing 5: `npm run test:summary:server:unit` passed with 979/979 tests green; the wrapper log was `test-results/server-unit-tests-2026-03-07T22-52-06-559Z.log`.
- Testing 6: `npm run test:summary:server:cucumber` passed with 68/68 tests green; the wrapper log was `test-results/server-cucumber-tests-2026-03-07T23-01-12-726Z.log`.
- Testing 7: `npm run test:summary:client` passed with 497/497 tests green; the wrapper log was `test-results/client-tests-2026-03-07T23-02-45-465Z.log`.
- Testing 8: `npm run test:summary:e2e` passed with 39/39 tests green; the wrapper log was `logs/test-summaries/e2e-tests-latest.log`.
- Subtask 14: Updated `design.md` to document finalized-inflight replay ignores and the stronger post-event Flow retention marker semantics, refreshed `projectStructure.md` to describe the delayed proof-based Flow marker, and refreshed the story `Acceptance audit` so Task 12 evidence replaces the superseded Task 11 closeout wording where relevant.
- Testing 9: Manual Playwright validation used `http://host.docker.internal:5001` with browser-side fake websocket/fetch control to replay the exact Task 12 cases, saved `0000042-task12-post-final-replay-hardened.png` and `0000042-task12-flow-marker-after-retention.png`, confirmed the finalized reply stayed singular with no phantom tail bubble, confirmed the earlier Flow bubble stayed visible while the next step streamed, and saw the expected replay/retention markers with no unexpected console errors.
- Subtask 15: Recorded the full Task 12 code, validation, documentation, and bookkeeping trail here incrementally so the final closeout state matches the actual execution order instead of a reconstructed summary.
- Subtask 16: `npm run lint --workspaces` completed with the same existing server import-order warnings and no new Task 12 errors; `npm run format:check --workspaces` passed cleanly across all workspaces.
- Testing 10: `npm run compose:down` stopped the local validation stack cleanly after the wrapper matrix and manual Playwright checks completed.

## Branch Review Against `main` (2026-03-07)

- Review scope:
  - compared `main...feature/0000042-flow-streaming-transcript-loss` with `git diff --stat`, `git diff --name-only`, and `git log --oneline main..HEAD`
  - re-reviewed the highest-risk code paths introduced on this branch, including shared streaming state, Flow retention logging, agent command step-start wiring, flow command resolution, runtime default resolution, and the related regression suites
- Files and areas re-checked:
  - `client/src/hooks/useChatStream.ts`
  - `client/src/hooks/useChatWs.ts`
  - `client/src/pages/FlowsPage.tsx`
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/api/agents.ts`
  - `server/src/routes/agentsCommands.ts`
  - `server/src/agents/commandsRunner.ts`
  - `server/src/agents/service.ts`
  - `server/src/flows/service.ts`
  - `server/src/config/chatDefaults.ts`
  - `server/src/config/runtimeConfig.ts`
  - `server/src/mcp2/tools/codebaseQuestion.ts`
  - the Story 42 acceptance audit and final wrapper/manual evidence in this plan
- Checks performed:
  - confirmed the final Story 42 acceptance criteria still map to explicit automated or manual evidence and remain marked `PASS`
  - confirmed the branch keeps the shared-hook-first fix boundary for transcript retention and does not widen the Flow-only fallback path beyond marker proof timing
  - confirmed the agent-command step-start work validates inputs at the route/service/runner layers and is covered by updated client/server tests
  - confirmed the flow command source-resolution changes preserve fail-fast behavior for invalid command files and include deterministic candidate ordering plus test coverage
  - confirmed the runtime/default-resolution and MCP codebase-question updates remain covered by unit and integration tests without widening API or persistence contracts
- Review outcome:
  - no additional blocking issues were identified in the branch diff against `main`
  - no new follow-up tasks were added because the implemented changes, regression coverage, and acceptance evidence are consistent with the story requirements

## Review Comment Follow-up 3

- Follow-up date: 2026-03-08
- Scope:
  - replaced the Flow retention marker's count-based post-event proof with exact assistant-message identity checks tied to the specific `previousInflightId` and `currentInflightId`
  - added a historical inflight-to-assistant-message lookup in `useChatStream` so `FlowsPage` can prove the named earlier bubble is still visible rather than inferring retention from assistant-bubble counts
  - kept the scope limited to marker-proof correctness; the shared finalized-inflight replay hardening from Task 12 was left intact
- Validation rerun:
  - `npm run build:summary:client` passed with the same existing Vite chunk-size warning only
  - `npm run test:summary:client` passed with 497/497 tests green in `test-results/client-tests-2026-03-08T00-03-45-549Z.log`
  - `npm run lint --workspaces` completed with the same pre-existing 57 server import-order warnings and no new errors
  - `npm run format:check --workspaces` passed cleanly after formatting `client/src/hooks/useChatStream.ts` and `client/src/pages/FlowsPage.tsx`

## Post-Story Client TypeScript Hardening Follow-up

These tasks are intentionally appended as follow-up hardening work and are not part of the original Story 42 transcript-loss acceptance bar.

- Why they are attached here:
  - the Story 42 branch work surfaced a large client-only TypeScript baseline that is currently outside the repo’s normal wrapper validation path
  - the baseline should be planned while the affected Flow/Chat/Agents areas are still fresh in branch context
- Current baseline reference:
  - on 2026-03-08, `npm run typecheck --workspace client` failed with a broad client baseline including high counts of `TS2339`, `TS2835`, `TS2345`, `TS2304`, and `TS7006`
  - the dominant failure classes are client module-resolution/import rules, missing browser/test ambient typings, overly-loose mock/test helper typing, and explicit runtime/component typing gaps across Chat, Flows, Agents, and related shared UI
- Planning rule for the tasks below:
  - if a later task rerun shows that a planned test-file fix no longer needs a direct file edit because an earlier shared/config fix removed the error, mark that subtask not applicable in-place and explain why in the task notes
  - if a residual family subtask below still requires edits in more than one test file at implementation time, split that family into one checkbox per touched test file before editing so the plan continues to follow the “one test-file modification per subtask” discipline

### 13. Client typecheck foundations and baseline collapse

- Task Status: `__done__`
- Git Commits:
  - `0696a5d1` - Collapse client typecheck foundations and record the reduced residual baseline for Tasks 14 and 15.

#### Overview

The first follow-up task must reduce the client baseline through shared foundations before any file-by-file cleanup begins. The current client typecheck output is dominated by root-cause problems that can make the per-file error list look much larger than the real residual work:

- the client inherits `NodeNext`/`NodeNext` compiler behavior from the shared base config even though the runtime is Vite/browser-oriented
- the client tsconfig currently exposes only `vite/client` types, so test and `process`/Node-related ambient names are not modeled cleanly for typecheck
- the Jest path executes TypeScript via `ts-jest`, but there is no wrapper-level client typecheck gate today
- shared test support files still allow mock types to collapse into `unknown`, `never`, or untyped `global` access patterns that then fan out into many individual test errors

Do not start mass-editing every test file before this task is complete. The goal here is to collapse the baseline first and then re-scope the remaining file-level work.

#### Documentation Locations

- TypeScript module resolution reference: https://www.typescriptlang.org/tsconfig/#moduleResolution
  - use this when deciding whether the client should override the shared `NodeNext` defaults with a browser/Vite-appropriate compiler mode
- TypeScript `module` reference: https://www.typescriptlang.org/tsconfig/#module
  - use this together with the module-resolution docs before changing client compiler options
- TypeScript `types` reference: https://www.typescriptlang.org/tsconfig/#types
  - use this when wiring explicit browser/test ambient typings for the client workspace
- TypeScript `isolatedModules` reference: https://www.typescriptlang.org/tsconfig/#isolatedModules
  - use this to understand why the Jest execution path does not replace a real project-wide typecheck gate
- Jest 30 docs: https://jestjs.io/docs/getting-started
  - use this when validating any shared test setup or environment changes
- Testing Library user-event docs: https://testing-library.com/docs/user-event/intro/
  - use this when standardizing the shared `userEvent` typing/import pattern

#### Subtasks

1. [x] Re-run `npm run typecheck --workspace client`, capture the current baseline counts and dominant error families in the Task 13 implementation notes, and confirm which categories are root-cause candidates versus true residual file-level defects.
   - Required outcome:
     - preserve the baseline command and the major error classes before editing
     - identify which classes are expected to collapse after tsconfig/shared-helper fixes
2. [x] Decide whether `client/tsconfig.json` should override the shared base `module`/`moduleResolution` settings for a Vite/browser workspace, then implement the least risky option.
   - Files to edit:
     - `client/tsconfig.json`
     - optionally `tsconfig.base.json` only if the client cannot safely solve this locally
   - Required outcome:
     - eliminate the client-only false-positive import-resolution baseline without weakening the server/compiler contract
     - if the shared base cannot be changed safely, keep the override client-local
3. [x] Add the explicit client ambient type entries required for browser, Jest, and any approved Node/test globals instead of relying on implicit `global` or missing `process` names.
   - Files to edit:
     - `client/tsconfig.json`
     - optional client-local ambient declarations file under `client/src` if needed
   - Required outcome:
     - `process`, `globalThis`, Jest globals, and DOM/browser test types are modeled intentionally rather than incidentally
4. [x] Update `client/src/test/setupTests.ts` so the shared test bootstrap exposes typed globals/mocks and no longer seeds downstream `global`/`never`/`unknown` type drift.
   - Required outcome:
     - shared setup should become the first place to fix fetch/EventSource/mock typing drift
5. [x] Update `client/src/test/support/mockChatWs.ts` so the websocket test helper exports strongly typed helpers instead of letting callback and payload shapes degrade into `unknown`.
6. [x] Update `client/src/test/support/ensureCodexFlagsPanelExpanded.ts` so the helper aligns with the chosen `userEvent` typing/import strategy and does not perpetuate incorrect helper signatures.
7. [x] Standardize the client-wide `userEvent` typing/import pattern and any shared typed mock helpers needed by later test files.
   - Required outcome:
     - the project should have one deliberate pattern for `userEvent.setup()`
     - later test files should consume shared typed helpers instead of repeating ad hoc casts
8. [x] Re-run `npm run typecheck --workspace client` and record the reduced post-foundation baseline, including the specific residual runtime file families and test file families that still need direct edits.
9. [x] If Task 13 changes the expected client compiler model or test environment contract, update `projectStructure.md` and this story file so the chosen typecheck approach is documented before file-by-file cleanup continues.
10. [x] Update Task 13 implementation notes continuously as each foundational fix lands.

#### Testing

1. [x] `npm run typecheck --workspace client` - Required pre-edit baseline capture.
2. [x] `npm run test:summary:client -- --file client/src/test/useChatWs.test.ts --file client/src/test/useConversationTurns.refresh.test.ts` - Shared helper smoke check after Task 13 setup/support changes.
3. [x] `npm run build:summary:client` - Required because compiler-config changes can affect the client build path.
4. [x] `npm run lint --workspaces`
5. [x] `npm run format:check --workspaces`
6. [x] `npm run typecheck --workspace client` - Required post-edit baseline reduction check.

#### Implementation notes

- Baseline captured on 2026-03-08 with `npm run typecheck --workspace client`; dominant codes were `TS2339` (407), `TS2835` (372), `TS2345` (224), `TS2304` (128), and `TS7006` (127).
- Root-cause candidates identified before editing: client `NodeNext` import-resolution mismatch for Vite/browser code, missing `node`/`jest` ambient typing for `process` and `global`, and shared test helpers that currently widen fetch/websocket/user-event types into `unknown`/`never`.
- Subtasks 2-7: kept the compiler-model fix client-local by switching `client/tsconfig.json` to bundler-style browser resolution, added explicit `jest`/`node` ambient types plus a shared test-environment declaration file, and introduced typed fetch/user-event helpers so `setupTests.ts`, `mockChatWs.ts`, and `ensureCodexFlagsPanelExpanded.ts` stop exporting loose helper contracts into later tests.
- Post-foundation baseline rerun on 2026-03-08 removed the `TS2835`/`TS2834` import-resolution flood entirely; dominant remaining codes are `TS2345` (227), `TS2322` (95), `TS2352` (38), `TS2339` (16), and `TS18046` (15).
- Residual runtime families frozen for Task 14: `client/src/components/Markdown.tsx`, chat sidebar/flags and device-auth dialog prop typing, `DirectoryPickerDialog.tsx`, `useChatStream.ts`, `useConversationTurns.ts`, `useConversations.ts`, `useIngestStatus.ts`, and page-level callback/value narrowing in `ChatPage.tsx`, `AgentsPage.tsx`, and `IngestPage.tsx`.
- Residual test families frozen for Task 15 onward: API helper tests using raw `jest.fn()` fetch mocks, Agents page command/run suites with untyped mock implementations, hook tests around `useChatStream`, `useConversationTurns`, and `useLogs`, plus a handful of version/logs helper assertions that still depend on direct per-file typing cleanup.
- Documentation updated in `projectStructure.md` and this task note set to reflect the client-local bundler-resolution override, explicit test ambient declarations, and shared typed `fetch`/`userEvent` support helpers introduced here.
- Testing 2: `npm run test:summary:client -- --file client/src/test/useChatWs.test.ts --file client/src/test/useConversationTurns.refresh.test.ts` passed with 21/21 tests green in `test-results/client-tests-2026-03-08T10-06-46-545Z.log`.
- Testing 3: `npm run build:summary:client` passed; inspected `logs/test-summaries/build-client-latest.log` and the only warning remained the existing Vite chunk-size warning.
- Testing 4: `npm run lint --workspaces` completed with the same pre-existing 57 server `import/order` warnings plus one client warning in generated `client/src/logging/logger.js` while emitted artifacts existed; there were no new lint errors from Task 13 source changes.
- Testing 5: initial `npm run format:check --workspaces` failed because `npm run typecheck --workspace client` still emits transient `.js` artifacts into `client/src`; after deleting the emitted files and formatting the touched sources, `npm run format:check --workspaces` passed cleanly.
- Testing 6: post-edit `npm run typecheck --workspace client` reran successfully as a failure-baseline capture and held at the reduced counts (`TS2345` 227, `TS2322` 95, `TS2352` 38, `TS2339` 16, `TS18046` 15), confirming the import-resolution flood stayed removed.

### 14. Client runtime source typing cleanup

- Task Status: `__done__`
- Git Commits:
  - `8eda0547` - `DEV-[0000042] - Clear client runtime typecheck residuals`

#### Overview

Once the foundational baseline is collapsed, the remaining non-test client files should be cleaned up in deliberate runtime groups rather than through opportunistic edits. The current baseline indicates residual work is concentrated in shared rendering/components, page-level callback typing, icon/component typing, and runtime hook return/value narrowing.

This task is for production/runtime source files only. Do not widen it into the full page/integration test suite; those test-file edits belong to later tasks once the shared/runtime surfaces are stable.

#### Documentation Locations

- React 19 docs: https://react.dev/reference/react
  - use this when tightening event handlers, component props, and state/value narrowing in page components
- MUI docs reference for current client component usage:
  - MUI MCP `@mui/material@6.4.12`
  - use this for icon/component prop typing, `slotProps`, input props, and select/button handler signatures
- React Markdown docs: https://github.com/remarkjs/react-markdown
  - use this for renderer typing updates in `Markdown.tsx`
- rehype-sanitize docs: https://github.com/rehypejs/rehype-sanitize
  - use this for schema typing corrections in markdown sanitization

#### Subtasks

1. [x] Re-run `npm run typecheck --workspace client` after Task 13 and freeze the residual non-test file list in the Task 14 implementation notes before editing.
2. [x] Fix the client shell/router/runtime entry file typing for:
   - `client/src/App.tsx`
   - `client/src/main.tsx`
   - `client/src/routes/router.tsx`
   - `client/src/routes/RouterErrorBoundary.tsx`
   - `client/src/pages/HomePage.tsx`
   - `client/src/pages/LmStudioPage.tsx`
   - `client/src/pages/LogsPage.tsx`
3. [x] Fix the API-layer typing for:
   - `client/src/api/agents.ts`
   - `client/src/api/baseUrl.ts`
   - `client/src/api/codex.ts`
   - `client/src/api/flows.ts`
4. [x] Fix the shared logging/runtime utility typing for:
   - `client/src/logging/index.ts`
   - `client/src/logging/logger.ts`
   - `client/src/logging/transport.ts`
5. [x] Fix the shared markdown/rendering and dialog component typing for:
   - `client/src/components/Markdown.tsx`
   - `client/src/components/codex/CodexDeviceAuthDialog.tsx`
6. [x] Fix the chat shared-component typing for:
   - `client/src/components/chat/CodexFlagsPanel.tsx`
   - `client/src/components/chat/ConversationList.tsx`
7. [x] Fix the ingest shared-component typing for:
   - `client/src/components/ingest/ActiveRunCard.tsx`
   - `client/src/components/ingest/DirectoryPickerDialog.tsx`
   - `client/src/components/ingest/IngestForm.tsx`
   - `client/src/components/ingest/RootDetailsDrawer.tsx`
   - `client/src/components/ingest/RootsTable.tsx`
   - `client/src/components/ingest/ingestDirsApi.ts`
8. [x] Fix the chat/flow/shared hook typing for:
   - `client/src/hooks/useChatModel.ts`
   - `client/src/hooks/useChatStream.ts`
   - `client/src/hooks/useChatWs.ts`
   - `client/src/hooks/useConversationTurns.ts`
   - `client/src/hooks/useConversations.ts`
   - `client/src/hooks/usePersistenceStatus.ts`
9. [x] Fix the ingest/status/log hook typing for:
   - `client/src/hooks/useIngestModels.ts`
   - `client/src/hooks/useIngestRoots.ts`
   - `client/src/hooks/useIngestStatus.ts`
   - `client/src/hooks/useLmStudioStatus.ts`
   - `client/src/hooks/useLogs.ts`
10. [x] Fix `client/src/pages/ChatPage.tsx`, including explicit callback/value typing, MUI handler signatures, and any remaining icon/component prop errors.
11. [x] Fix `client/src/pages/FlowsPage.tsx`, including explicit callback typing and `unknown` error narrowing.
12. [x] Fix `client/src/pages/AgentsPage.tsx`, including the largest remaining page-level callback/value typing set after Task 13.
13. [x] Fix `client/src/pages/IngestPage.tsx` and any remaining ingest-page runtime typing after the shared ingest components are corrected.
14. [x] Re-run targeted client wrappers for the runtime areas touched in this task and confirm the residual client typecheck baseline no longer contains non-test source-file errors introduced by these pages/components/hooks.
15. [x] Update `design.md`, `projectStructure.md`, and this story file if Task 14 changes any documented client runtime typing contracts, helper signatures, or expected compiler assumptions.
16. [x] Update Task 14 implementation notes continuously as each runtime source fix lands.

#### Testing

1. [x] `npm run test:summary:client -- --file client/src/test/chatPage.stream.test.tsx --file client/src/test/flowsPage.run.test.tsx --file client/src/test/agentsPage.streaming.test.tsx`
2. [x] `npm run build:summary:client`
3. [x] `npm run lint --workspaces`
4. [x] `npm run format:check --workspaces`
5. [x] `npm run typecheck --workspace client`

#### Implementation notes

- Baseline frozen on 2026-03-08 from `npm run typecheck --workspace client`; current non-test residual files are `Markdown.tsx`, `CodexFlagsPanel.tsx`, `ConversationList.tsx`, `CodexDeviceAuthDialog.tsx`, `DirectoryPickerDialog.tsx`, `useChatStream.ts`, `useConversationTurns.ts`, `useConversations.ts`, `useIngestStatus.ts`, `ChatPage.tsx`, `AgentsPage.tsx`, and `IngestPage.tsx`.
- No direct residual errors remained in the Task 14 entry/router group, API-layer group, or shared logging utility group at baseline time, so those groups can be closed without file edits if they stay clean after the runtime fixes land.
- Subtasks 2-4 closed without source edits after the post-fix `typecheck` reruns confirmed `App.tsx`, `main.tsx`, router files, API files, and shared logging utilities still had no direct residual errors beyond the Task 13 baseline.
- Subtask 5 tightened `Markdown.tsx` to use the current `react-markdown`/`rehype-sanitize` typings, moved external-link targeting into the anchor renderer, and removed the stale device-auth API argument in `CodexDeviceAuthDialog.tsx`.
- Subtask 6 replaced the remaining MUI test-id prop patterns in the chat shared components with typed helper wrappers and removed the always-true optional-handler guards that Task 13 left behind in `ConversationList.tsx`.
- Subtask 7 narrowed the ingest directory picker response on the success path and confirmed the rest of the shared ingest component family stayed runtime-clean without direct edits.
- Subtask 8 resolved the remaining hook-side runtime typing by stabilizing assistant-id creation in `useChatStream.ts`, explicitly typing the hydrated inflight snapshot in `useConversationTurns.ts`, and adding safe bulk-error fallbacks in `useConversations.ts`.
- Subtask 9 replaced the nullable ingest snapshot log payload in `useIngestStatus.ts`; `useIngestModels.ts`, `useIngestRoots.ts`, `useLmStudioStatus.ts`, and `useLogs.ts` stayed clean after the runtime pass.
- Subtask 10 updated `ChatPage.tsx` with explicit reducer generics, safer payload/error booleans, typed select display helpers, modern MUI slot props, and a button callback wrapper so the page no longer carries direct runtime typecheck errors.
- Subtask 11 closed without edits because `FlowsPage.tsx` remained clear in the runtime-only residual list after the Task 14 reruns.
- Subtask 12 updated `AgentsPage.tsx` with explicit reducer generics, guarded inflight cancellation, stable boolean wiring for the shared conversation list handlers, and safe tool payload/error rendering checks.
- Subtask 13 normalized the ingest-page embedding provider before it flows into the shared ingest components so `IngestPage.tsx` no longer leaks broad string values into the locked-model props.
- Subtask 14 reran the targeted client regression wrapper plus repeated client `typecheck` snapshots until the runtime-only residual list was empty; the remaining baseline is now fully isolated to test files for Task 15 onward.
- Subtask 15 updated `projectStructure.md` and this story file for Task 14 traceability; `design.md` did not need a content change because the cleanup tightened runtime typing without changing the documented user-visible stream or ingest behavior.
- Subtask 16 kept this note trail live as each Task 14 runtime group and validation step completed rather than batching the evidence at the end.
- Testing 1: `npm run test:summary:client -- --file client/src/test/chatPage.stream.test.tsx --file client/src/test/flowsPage.run.test.tsx --file client/src/test/agentsPage.streaming.test.tsx` passed with 50/50 tests green in `test-results/client-tests-2026-03-08T10-27-50-352Z.log`.
- Testing 2: `npm run build:summary:client` passed; `logs/test-summaries/build-client-latest.log` still only reported the existing Vite chunk-size warning rather than a Task 14 regression.
- Testing 3: `npm run lint --workspaces` completed with the same pre-existing 57 server `import/order` warnings plus one transient client warning in emitted `client/src/logging/logger.js`; there were no new lint errors from the Task 14 runtime-source changes.
- Testing 4: deleted the transient `.js` artifacts emitted into `client/src` by the current `typecheck` command, ran Prettier write on `client/src/hooks/useConversations.ts` after the first check failed, and then `npm run format:check --workspaces` passed cleanly.
- Testing 5: final `npm run typecheck --workspace client` still failed only because Task 15+ test files remain in the baseline; the runtime-only grep from `/tmp/task14-final-typecheck.b78d.log` was empty, confirming Task 14 removed all direct non-test client source errors.

### 15. Client shared test infrastructure and hook/API typing cleanup

- Task Status: `__done__`
- Git Commits:
  - `83d1c3cb` - DEV-[0000042] - Clear low-level client test typing residuals

#### Overview

After Tasks 13 and 14, the remaining low-level client test failures should be cleaned up before the page-level integration suites. This task covers shared test infrastructure, API tests, logging tests, and hook-focused tests where the dominant work is typing the mocks and helper contracts rather than page rendering logic.

Because Task 13 may remove some direct test edits entirely, re-freeze the residual test-file list before touching anything. For every test file that still needs a direct edit during Task 15, preserve the one-file-per-subtask discipline by splitting any remaining family bucket into separate checkboxes before editing.

#### Documentation Locations

- Jest mock functions docs: https://jestjs.io/docs/mock-functions
  - use this when replacing `unknown`/`never` mock flows with typed mock helpers
- Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
  - use this for hook render typing and shared test helper patterns
- Testing Library user-event docs: https://testing-library.com/docs/user-event/intro/
  - use this when correcting `userEvent.setup()` usage across low-level tests

#### Subtasks

1. [x] Re-run `npm run typecheck --workspace client` after Tasks 13 and 14, freeze the residual non-page test-file list for Task 15, and split any remaining multi-file family buckets into one checkbox per touched test file before editing.
2. [x] Fix `client/src/test/setupTests.ts` if it still has residual direct type errors after Task 13.
3. [x] Fix `client/src/test/support/mockChatWs.ts` if it still has residual direct type errors after Task 13.
4. [x] Fix `client/src/test/support/ensureCodexFlagsPanelExpanded.ts` if it still has residual direct type errors after Task 13.
5. [x] Fix `client/src/test/logging/transport.test.ts`.
6. [x] Fix `client/src/test/codexDeviceAuthApi.test.ts`.
7. [x] Fix `client/src/test/flowsApi.test.ts`.
8. [x] Fix `client/src/test/flowsApi.run.payload.test.ts`.
9. [x] Fix `client/src/test/agentsApi.commandsList.test.ts`.
10. [x] Fix `client/src/test/agentsApi.commandsRun.test.ts`.
11. [x] Fix `client/src/test/agentsApi.errors.test.ts`.
12. [x] Fix `client/src/test/agentsApi.promptsList.test.ts`.
13. [x] Fix `client/src/test/agentsApi.workingFolder.payload.test.ts`.
14. [x] Fix `client/src/test/useChatWs.test.ts`.
15. [x] Fix `client/src/test/useConversationTurns.commandMetadata.test.ts`.
16. [x] Fix `client/src/test/useConversationTurns.refresh.test.ts`.
17. [x] Fix `client/src/test/useConversations.source.test.ts`.
18. [x] Fix `client/src/test/useChatStream.inflightMismatch.test.tsx`.
19. [x] Fix `client/src/test/useChatStream.reasoning.test.tsx` if it still has residual direct type errors after the shared/helper cleanup.
20. [x] Fix `client/src/test/useChatStream.toolPayloads.test.tsx`.
21. [x] Fix `client/src/test/useIngestModels.test.tsx`.
22. [x] Fix `client/src/test/useIngestRoots.test.tsx`.
23. [x] Fix `client/src/test/useLmStudioStatus.test.ts`.
24. [x] Fix `client/src/test/useLogs.test.ts`.
25. [x] Re-run the targeted low-level client test wrappers touched in Task 15 and confirm the residual baseline has moved primarily to page/integration test files only.
26. [x] Update Task 15 implementation notes continuously as each low-level test fix lands.

#### Testing

1. [x] `npm run test:summary:client -- --file client/src/test/useChatWs.test.ts --file client/src/test/useConversationTurns.refresh.test.ts --file client/src/test/useChatStream.inflightMismatch.test.tsx --file client/src/test/useLogs.test.ts`
2. [x] `npm run build:summary:client`
3. [x] `npm run lint --workspaces`
4. [x] `npm run format:check --workspaces`
5. [x] `npm run typecheck --workspace client`

#### Implementation notes

- Baseline frozen on 2026-03-08 from `npm run typecheck --workspace client`; the Task 15 non-page residual set is `setupTests.ts`, `support/mockChatWs.ts`, `logging/transport.test.ts`, `codexDeviceAuthApi.test.ts`, `flowsApi.test.ts`, `flowsApi.run.payload.test.ts`, `agentsApi.commandsList.test.ts`, `agentsApi.commandsRun.test.ts`, `agentsApi.errors.test.ts`, `agentsApi.promptsList.test.ts`, `agentsApi.workingFolder.payload.test.ts`, `useChatWs.test.ts`, `useConversationTurns.commandMetadata.test.ts`, `useConversationTurns.refresh.test.ts`, `useConversations.source.test.ts`, `useChatStream.inflightMismatch.test.tsx`, `useChatStream.toolPayloads.test.tsx`, `useIngestModels.test.tsx`, `useIngestRoots.test.tsx`, `useLmStudioStatus.test.ts`, and `useLogs.test.ts`.
- `client/src/test/support/ensureCodexFlagsPanelExpanded.ts`, `client/src/test/clientLogging.test.ts`, `client/src/test/logging/logger.test.ts`, `client/src/test/reasoningCapabilities.normalize.test.ts`, and `client/src/test/useChatStream.reasoning.test.tsx` were clean at baseline time, so they should only be edited if later shared-helper changes expose a direct residual.
- Page and integration suites still dominate the broader baseline (`chatPage.*`, `flowsPage.*`, `agentsPage.*`, ingest/logs/router/version page tests, and `codexDeviceAuthDialog.test.tsx`), but those remain intentionally deferred to Task 16 and were excluded from the Task 15 fix list.
- Subtasks 2-4 closed by tightening the shared fetch/bootstrap typing in `setupTests.ts`, confirming `mockChatWs.ts` stayed clean under the typed helper contract, and reconfirming `ensureCodexFlagsPanelExpanded.ts` did not regress after the shared `userEvent` helper changes from Task 13.
- Subtasks 5-13 replaced the remaining low-level API/logging response literals with typed shared fetch helpers (`mockJsonResponse`, `mockTextResponse`, `asFetchImplementation`) so the low-level API suites no longer depended on `Response` casts or `unknown` mock signatures.
- Subtasks 14-18 and 20-24 cleaned up the remaining hook/test-helper residuals by typing reconnect callbacks in `useChatWs.test.ts`, converting the `useConversationTurns` suites to typed fetch snapshots, aligning `useChatStream.inflightMismatch.test.tsx` with the current `turn_final`/segment contracts, using typed fetch mocks in `useChatStream.toolPayloads.test.tsx`, and simplifying the EventSource constructor typing in `useLogs.test.ts`.
- Subtask 19 closed without edits because `useChatStream.reasoning.test.tsx` stayed out of the residual list after the shared helper cleanup reruns.
- Subtask 25: `npm run test:summary:client -- --file client/src/test/useChatWs.test.ts --file client/src/test/useConversationTurns.refresh.test.ts --file client/src/test/useChatStream.inflightMismatch.test.tsx --file client/src/test/useLogs.test.ts` passed with 48/48 tests green in `test-results/client-tests-2026-03-08T10-52-04-377Z.log`, and the follow-up `npm run typecheck --workspace client` rerun showed no remaining direct Task 15 file errors.
- Subtask 26: kept the Task 15 note trail current while the residual list collapsed, rather than batching the low-level file closeout at the end.
- Testing 1: `npm run test:summary:client -- --file client/src/test/useChatWs.test.ts --file client/src/test/useConversationTurns.refresh.test.ts --file client/src/test/useChatStream.inflightMismatch.test.tsx --file client/src/test/useLogs.test.ts` passed again with 48/48 tests green in `test-results/client-tests-2026-03-08T10-52-55-556Z.log`.
- Testing 2: `npm run build:summary:client` passed; `logs/test-summaries/build-client-latest.log` still only reported the existing Vite chunk-size warning rather than a Task 15 regression.
- Testing 3: `npm run lint --workspaces` completed with the same pre-existing 57 server `import/order` warnings after the Task 15 cleanup removed the transient client unused-import errors and deleted the emitted client `.js` artifacts.
- Testing 4: `npm run format:check --workspaces` failed once on four Task 15 files, ran `npx prettier --write` on those files, and then passed cleanly on rerun.
- Testing 5: final `npm run typecheck --workspace client` still exited non-zero in `/tmp/task15-final-typecheck.qp9O.log`, but the remaining baseline is now isolated to Task 16 page/integration suites (`agentsPage.*`, `chatPage.*`, `flowsPage.*`, `chatSendPayload.test.tsx`, `chatSidebar.test.tsx`, `chatPersistenceBanner.test.tsx`, and `codexDeviceAuthDialog.test.tsx`); no Task 15 file remained in the residual list.

### 16. Client page and integration test typing cleanup plus typecheck gate

- Task Status: `__done__`
- Git Commits:
  - `1a525ec2` - `DEV-[0000042] - Finish client page typecheck cleanup`

#### Overview

The final follow-up task should finish the client typecheck baseline by cleaning up the remaining page/integration tests and then making client type safety part of the normal validation workflow. This task is expected to contain the most residual file-by-file cleanup because many page tests duplicate fetch/user-event/mock patterns and page-specific render helpers.

This task should not begin until Tasks 13 through 15 have reduced the residual list. Before editing, freeze the remaining page/integration test files and split any multi-file family buckets into one checkbox per touched test file.

#### Documentation Locations

- Jest docs: https://jestjs.io/docs/getting-started
  - use this when finishing page-level test typing and any wrapper/json output integration
- Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
  - use this for page render/helper typing across Chat, Flows, Agents, Ingest, Logs, and Router tests
- Playwright docs: https://playwright.dev/docs/intro
  - use this only if a client typecheck gate update requires any e2e-related wrapper or docs adjustment

#### Subtasks

1. [x] Re-run `npm run typecheck --workspace client` after Tasks 13 through 15, freeze the residual page/integration test file list, and split any remaining family buckets into one checkbox per touched test file before editing.
2. [x] Fix the remaining Chat-page-oriented test files one by one.
   - [x] `client/src/test/chatSendPayload.test.tsx`
   - [x] `client/src/test/chatSidebar.test.tsx`
   - [x] `client/src/test/chatPersistenceBanner.test.tsx`
   - [x] `client/src/test/chatPage.citations.test.tsx`
   - [x] `client/src/test/chatPage.codexBanners.test.tsx`
   - [x] `client/src/test/chatPage.codexDefaults.test.tsx`
   - [x] `client/src/test/chatPage.flags.approval.default.test.tsx`
   - [x] `client/src/test/chatPage.flags.approval.payload.test.tsx`
   - [x] `client/src/test/chatPage.flags.network.default.test.tsx`
   - [x] `client/src/test/chatPage.flags.network.payload.test.tsx`
   - [x] `client/src/test/chatPage.flags.panelCollapsed.test.tsx`
   - [x] `client/src/test/chatPage.flags.reasoning.default.test.tsx`
   - [x] `client/src/test/chatPage.flags.reasoning.payload.test.tsx`
   - [x] `client/src/test/chatPage.flags.sandbox.default.test.tsx`
   - [x] `client/src/test/chatPage.flags.sandbox.payload.test.tsx`
   - [x] `client/src/test/chatPage.flags.sandbox.reset.test.tsx`
   - [x] `client/src/test/chatPage.flags.websearch.default.test.tsx`
   - [x] `client/src/test/chatPage.flags.websearch.payload.test.tsx`
   - [x] `client/src/test/chatPage.focusRefresh.test.tsx`
   - [x] `client/src/test/chatPage.inflightNavigate.test.tsx`
   - [x] `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx`
   - [x] `client/src/test/chatPage.layoutHeight.test.tsx`
   - [x] `client/src/test/chatPage.layoutWrap.test.tsx`
   - [x] `client/src/test/chatPage.models.test.tsx`
   - [x] `client/src/test/chatPage.newConversation.test.tsx`
   - [x] `client/src/test/chatPage.noPaths.test.tsx`
   - [x] `client/src/test/chatPage.provider.conversationSelection.test.tsx`
   - [x] `client/src/test/chatPage.provider.test.tsx`
   - [x] `client/src/test/chatPage.reasoning.test.tsx`
   - [x] `client/src/test/chatPage.source.test.tsx`
   - [x] `client/src/test/chatPage.stop.test.tsx`
   - [x] `client/src/test/chatPage.stream.test.tsx`
   - [x] `client/src/test/chatPage.toolDetails.test.tsx`
3. [x] Fix the remaining Flow-page-oriented test files one by one.
   - [x] `client/src/test/flowsPage.test.tsx`
   - [x] `client/src/test/flowsPage.run.test.tsx`
   - [x] `client/src/test/flowsPage.stop.test.tsx`
4. [x] Fix the remaining Agents-page-oriented test files one by one.
   - [x] `client/src/test/agentsPage.agentChange.test.tsx`
   - [x] `client/src/test/agentsPage.citations.test.tsx`
   - [x] `client/src/test/agentsPage.commandsList.test.tsx`
   - [x] `client/src/test/agentsPage.commandsRun.abort.test.tsx`
   - [x] `client/src/test/agentsPage.commandsRun.conflict.test.tsx`
   - [x] `client/src/test/agentsPage.commandsRun.persistenceDisabled.test.tsx`
   - [x] `client/src/test/agentsPage.commandsRun.refreshTurns.test.tsx`
   - [x] `client/src/test/agentsPage.conversationSelection.test.tsx`
   - [x] `client/src/test/agentsPage.descriptionPopover.test.tsx`
   - [x] `client/src/test/agentsPage.executePrompt.test.tsx`
   - [x] `client/src/test/agentsPage.layoutWrap.test.tsx`
   - [x] `client/src/test/agentsPage.list.test.tsx`
   - [x] `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`
   - [x] `client/src/test/agentsPage.persistenceFallbackSegments.test.tsx`
   - [x] `client/src/test/agentsPage.promptsDiscovery.test.tsx`
   - [x] `client/src/test/agentsPage.reasoning.test.tsx`
   - [x] `client/src/test/agentsPage.run.commandError.test.tsx`
   - [x] `client/src/test/agentsPage.run.instructionError.test.tsx`
   - [x] `client/src/test/agentsPage.run.test.tsx`
   - [x] `client/src/test/agentsPage.sidebarActions.test.tsx`
   - [x] `client/src/test/agentsPage.sidebarWs.test.tsx`
   - [x] `client/src/test/agentsPage.statusChip.test.tsx`
   - [x] `client/src/test/agentsPage.streaming.test.tsx`
   - [x] `client/src/test/agentsPage.toolsUi.test.tsx`
   - [x] `client/src/test/agentsPage.turnHydration.test.tsx`
   - [x] `client/src/test/agentsPage.workingFolderPicker.test.tsx`
5. [x] Fix the remaining ingest/logs/router/version/device-auth page/integration test files one by one.
   - [x] `client/src/test/ingestForm.test.tsx`
   - [x] `client/src/test/ingestRoots.test.tsx`
   - [x] `client/src/test/lmstudio.test.tsx`
   - [x] `client/src/test/logsPage.test.tsx`
   - [x] `client/src/test/router.test.tsx`
   - [x] `client/src/test/version.test.tsx`
   - [x] `client/src/test/codexDeviceAuthDialog.test.tsx`
6. [x] If the repo still lacks a wrapper-first client typecheck path after the baseline is green, add a compact summary wrapper and root package script for client typecheck so future stories do not regress this gap silently.
   - Files to edit if needed:
     - `scripts/`
     - root `package.json`
     - optional docs that enumerate available wrappers
7. [x] Update `AGENTS.md`, `projectStructure.md`, and this story file if Task 16 changes the expected validation workflow by introducing a new client typecheck summary wrapper or a new required validation step.
8. [x] Run the full final client validation matrix for this follow-up track once the typecheck baseline is green.
   - Required command set:
     - `npm run build:summary:client`
     - `npm run test:summary:client`
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
     - `npm run typecheck --workspace client` or the new wrapper if Task 16 adds one
9. [x] Update Task 16 implementation notes continuously as each remaining page/integration test fix lands and once the client typecheck gate is fully green.

#### Testing

1. [x] `npm run test:summary:client -- --subset chatPage`
2. [x] `npm run test:summary:client -- --subset flowsPage`
3. [x] `npm run test:summary:client -- --subset agentsPage`
4. [x] `npm run test:summary:client -- --subset ingest`
5. [x] `npm run build:summary:client`
6. [x] `npm run test:summary:client`
7. [x] `npm run lint --workspaces`
8. [x] `npm run format:check --workspaces`
9. [x] `npm run typecheck --workspace client` or the new wrapper added in Subtask 6

#### Implementation notes

- Baseline frozen on 2026-03-08 from `npm run typecheck --workspace client`; fresh Task 16 residual files are `chatSendPayload.test.tsx`, `chatSidebar.test.tsx`, `chatPersistenceBanner.test.tsx`, `chatPage.citations.test.tsx`, `chatPage.codexBanners.test.tsx`, `chatPage.codexDefaults.test.tsx`, `chatPage.flags.approval.default.test.tsx`, `chatPage.flags.approval.payload.test.tsx`, `chatPage.flags.network.default.test.tsx`, `chatPage.flags.network.payload.test.tsx`, `chatPage.flags.panelCollapsed.test.tsx`, `chatPage.flags.reasoning.default.test.tsx`, `chatPage.flags.reasoning.payload.test.tsx`, `chatPage.flags.sandbox.default.test.tsx`, `chatPage.flags.sandbox.payload.test.tsx`, `chatPage.flags.sandbox.reset.test.tsx`, `chatPage.flags.websearch.default.test.tsx`, `chatPage.flags.websearch.payload.test.tsx`, `chatPage.focusRefresh.test.tsx`, `chatPage.inflightNavigate.test.tsx`, `chatPage.inflightSnapshotRefreshMerge.test.tsx`, `chatPage.layoutHeight.test.tsx`, `chatPage.layoutWrap.test.tsx`, `chatPage.models.test.tsx`, `chatPage.newConversation.test.tsx`, `chatPage.noPaths.test.tsx`, `chatPage.provider.conversationSelection.test.tsx`, `chatPage.provider.test.tsx`, `chatPage.reasoning.test.tsx`, `chatPage.source.test.tsx`, `chatPage.stop.test.tsx`, `chatPage.stream.test.tsx`, `chatPage.toolDetails.test.tsx`, `flowsPage.test.tsx`, `flowsPage.run.test.tsx`, `flowsPage.stop.test.tsx`, `agentsPage.agentChange.test.tsx`, `agentsPage.citations.test.tsx`, `agentsPage.commandsList.test.tsx`, `agentsPage.commandsRun.abort.test.tsx`, `agentsPage.commandsRun.conflict.test.tsx`, `agentsPage.commandsRun.persistenceDisabled.test.tsx`, `agentsPage.commandsRun.refreshTurns.test.tsx`, `agentsPage.conversationSelection.test.tsx`, `agentsPage.descriptionPopover.test.tsx`, `agentsPage.executePrompt.test.tsx`, `agentsPage.layoutWrap.test.tsx`, `agentsPage.list.test.tsx`, `agentsPage.navigateAway.keepsRun.test.tsx`, `agentsPage.persistenceFallbackSegments.test.tsx`, `agentsPage.promptsDiscovery.test.tsx`, `agentsPage.reasoning.test.tsx`, `agentsPage.run.commandError.test.tsx`, `agentsPage.run.instructionError.test.tsx`, `agentsPage.run.test.tsx`, `agentsPage.sidebarActions.test.tsx`, `agentsPage.sidebarWs.test.tsx`, `agentsPage.statusChip.test.tsx`, `agentsPage.streaming.test.tsx`, `agentsPage.toolsUi.test.tsx`, `agentsPage.turnHydration.test.tsx`, `agentsPage.workingFolderPicker.test.tsx`, `ingestForm.test.tsx`, `ingestRoots.test.tsx`, `lmstudio.test.tsx`, `logsPage.test.tsx`, `router.test.tsx`, `version.test.tsx`, and `codexDeviceAuthDialog.test.tsx`.
- `ingestPage.layout.test.tsx`, `ingestStatus.progress.test.tsx`, and `ingestStatus.test.tsx` were in the Task 16 initial expected family text but did not appear in the fresh baseline, so they should stay untouched unless later shared fixes reintroduce direct residuals.
- Subtasks 2-5: standardized the remaining page-suite fetch mocks around typed helpers, replaced lingering raw `Response` cast shims with real `Response` objects or shared helpers, and tightened a few page-specific prop/deferred callback annotations until `npm run typecheck --workspace client` reached a green baseline.
- Subtask 6: added `scripts/typecheck-summary-client.mjs` plus the root `npm run typecheck:summary:client` script so Task 16 validation can stay wrapper-first even before Task 17 converts the underlying workspace command to non-emitting behavior.
- Subtask 7: updated `AGENTS.md` and `projectStructure.md` so the new client typecheck summary wrapper is part of the documented repo workflow and file-map contract.
- Subtask 8: completed the full Task 16 validation matrix once the page/integration baseline and wrapper-first typecheck path were both green.
- Subtask 9: kept this section current while landing each cleanup batch; after the final wrapper pass, the only extra hygiene step was deleting the emitted `client/src/**/*.js` artifacts that the current `tsc -b` command still writes before Task 17 converts it to non-emitting behavior.
- Testing 1: `npm run test:summary:client -- --subset chatPage` passed with 115/115 tests green after aligning the remaining Codex flag payload mocks to the current model-capability contract, updating the markdown sanitization assertion, and deleting emitted `client/src/**/*.js` artifacts that were polluting Jest resolution.
- Testing 2: `npm run test:summary:client -- --subset flowsPage` passed with 24/24 tests green, confirming the page-test typing cleanup did not break the Flow run/stop/resume regression coverage.
- Testing 3: `npm run test:summary:client -- --subset agentsPage` passed with 124/124 tests green after tightening the outdated abort-before-inflight expectation and wrapping the remaining realtime WS replay assertions in `act(...)`; one earlier subset retry was discarded after isolated file reruns proved the broader failure burst was runner-state noise rather than a persistent code regression.
- Testing 4: `npm run test:summary:client -- --subset ingest` passed with 72/72 tests green, confirming the typed ingest form/root helper cleanup preserved the ingest page and component flows.
- Testing 5: `npm run build:summary:client` passed; `logs/test-summaries/build-client-latest.log` only repeated the existing Vite chunk-size warning and did not introduce any Task 16 build regressions.
- Testing 6: `npm run test:summary:client` passed with 497/497 tests green after updating the shared Codex device-auth dialog test to match the current zero-argument API call shape.
- Testing 7: `npm run lint --workspaces` completed with no new errors; the same pre-existing 57 server `import/order` warnings remained unchanged.
- Testing 8: `npm run format:check --workspaces` passed after rerunning `npm run format --workspace client` to normalize the touched page and integration test files.
- Testing 9: `npm run typecheck:summary:client` passed with `errors: 0` and wrote `logs/test-summaries/typecheck-client-latest.log`; the emitted `client/src/**/*.js` artifacts were deleted immediately afterward so the worktree returned to source-only changes before commit.

### 17. Client non-emitting typecheck command and build-wrapper preflight

- Task Status: `__done__`
- Git Commits:
  - `10f723dc` - `DEV-[0000042] - Add client build typecheck preflight`

#### Overview

Once the client typecheck baseline is close to green, the repo should gain a real non-emitting client typecheck command and the client build summary wrapper should run that command before it starts the Vite build. This closes the gap where frontend changes can appear buildable to the wrapper path while still carrying TypeScript correctness defects.

This task is intentionally limited to the client typecheck command and the client build summary wrapper. Do not widen it into the client test wrapper; behavioral tests should remain separate from the static type gate.

#### Documentation Locations

- TypeScript `noEmit` reference: https://www.typescriptlang.org/tsconfig/#noEmit
  - use this when deciding whether the client can rely on `tsc --noEmit` directly or needs a dedicated typecheck tsconfig
- TypeScript project references/build mode reference: https://www.typescriptlang.org/docs/handbook/project-references.html
  - use this when confirming the client should move away from the current emitting `tsc -b` workflow for typecheck
- Node child_process docs: https://nodejs.org/api/child_process.html
  - use this when updating the wrapper process flow so the pre-build typecheck phase preserves log capture and exit behavior

#### Subtasks

1. [x] Re-read the current client typecheck command, client tsconfig, and client build summary wrapper before editing.
   - Files to read:
     - `client/package.json`
     - `client/tsconfig.json`
     - `scripts/build-summary-client.mjs`
2. [x] Replace the current client `typecheck` npm script with a non-emitting TypeScript check.
   - Files to edit:
     - `client/package.json`
   - Required outcome:
     - the command must not emit `.js` artifacts into `client/src`
     - the command should remain easy to run directly for targeted diagnosis
3. [x] Add `client/tsconfig.typecheck.json` only if the client cannot safely express the non-emitting check through the existing `client/tsconfig.json`.
   - Files to edit only if required:
     - `client/tsconfig.typecheck.json`
     - `client/tsconfig.json`
   - Required outcome:
     - keep the typecheck config client-local
     - avoid widening the change into server or shared compiler behavior
4. [x] Update `scripts/build-summary-client.mjs` so it runs the client typecheck command before `npm run build --workspace client`.
   - Required outcome:
     - if typecheck fails, the wrapper must stop before starting the Vite build
     - the wrapper must still print the failure status and log path for AI-agent diagnosis
     - the wrapper output should make the failed phase obvious (`typecheck` vs `build`)
5. [x] Preserve the existing compact wrapper behavior after the pre-build typecheck phase is added.
   - Required outcome:
     - keep the concise summary format
     - keep the existing log file location contract
     - keep warning counting meaningful for the real build phase
6. [x] Add or update wrapper-level automated coverage if the repo already has a pattern for script/wrapper tests; otherwise document the wrapper contract change in the task notes and workflow docs.
7. [x] Update Task 17 implementation notes continuously as each change lands.

#### Testing

1. [x] `npm run typecheck --workspace client`
2. [x] `npm run build:summary:client`
3. [x] Confirm that a forced client typecheck failure stops the wrapper before the build phase and still prints the log path.
4. [x] `npm run lint --workspaces`
5. [x] `npm run format:check --workspaces`

#### Implementation notes

- Subtask 1: Re-read `client/package.json`, `client/tsconfig.json`, and `scripts/build-summary-client.mjs`; confirmed the current client `typecheck` still uses emitting `tsc -b`, while direct `npx tsc --noEmit -p tsconfig.json` succeeds client-locally and should let Task 17 stay within existing client config unless a wrapper integration detail proves otherwise.
- Subtask 2: Replaced the client workspace `typecheck` script with `tsc --noEmit -p tsconfig.json`, keeping the command direct and targeted while stopping `.js` emission into `client/src`.
- Subtask 3: No extra `client/tsconfig.typecheck.json` was needed because the existing client-local `tsconfig.json` already works for the non-emitting check without widening scope into shared/server compiler settings.
- Subtask 4: Updated `scripts/build-summary-client.mjs` to run `npm run typecheck --workspace client` before the Vite build and to stop immediately if the typecheck phase fails.
- Subtask 5: Preserved the existing compact wrapper contract by keeping the same log path, counting warnings only from the actual build phase, and printing an explicit `phase` field so failures are clearly attributed to `typecheck` or `build`.
- Subtask 6: No existing wrapper-test pattern was found in the repo, so the wrapper contract change is documented here and will be reflected in workflow docs during Task 18 instead of adding ad hoc script tests in this task.
- Subtask 7: Kept this section current while landing the non-emitting command, wrapper preflight, and forced-failure proof so Task 18 can build directly on the updated contract.
- Testing 1: `npm run typecheck --workspace client` passed with the new non-emitting command and did not recreate any `client/src/**/*.js` artifacts.
- Testing 2: `npm run build:summary:client` passed with the new pre-build typecheck path; the wrapper now reports `phase: build` on success and still only surfaced the existing single Vite chunk-size warning.
- Testing 3: A temporary `client/src/__task17_typecheck_failure_sentinel.ts` file forced a client typecheck error, and `npm run build:summary:client` failed fast with `status: failed`, `phase: typecheck`, `warnings: 0`, and the existing `logs/test-summaries/build-client-latest.log` path before the build phase could start; the sentinel file was deleted immediately after the proof run.
- Testing 4: `npm run lint --workspaces` completed with no new errors; the same pre-existing 57 server `import/order` warnings remained unchanged.
- Testing 5: `npm run format:check --workspaces` passed cleanly after the wrapper and package-script edits.

### 18. Client build-validation workflow update and final verification

- Task Status: `__done__`
- Git Commits:
  - `e4bcd3d9` - `DEV-[0000042] - Document client build validation workflow`

#### Overview

After the build wrapper absorbs the client typecheck gate, the documented frontend workflow should be updated so future work treats `npm run build:summary:client` as both a buildability check and a TypeScript correctness gate. This task is about workflow clarity, validation expectations, and final verification rather than about changing the client test wrapper.

Keep the direct client `typecheck` command available for targeted local diagnosis even after the build wrapper starts calling it automatically.

#### Documentation Locations

- Repo workflow docs:
  - `AGENTS.md`
  - `projectStructure.md`
  - this story file
- Build workflow wrapper guidance already used in this repo:
  - `scripts/build-summary-client.mjs`
  - root `package.json`

#### Subtasks

1. [x] Update the documented frontend workflow so `npm run build:summary:client` explicitly includes the client typecheck pre-build gate.
   - Files to edit:
     - `AGENTS.md`
     - `projectStructure.md`
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
2. [x] Update any Story 42 validation wording that currently treats client build and client typecheck as unrelated checks if Task 17 makes build imply typecheck.
3. [x] Keep `npm run typecheck --workspace client` documented as the targeted direct command for local diagnosis even after Task 17 lands.
4. [x] Re-run the final client validation matrix once the wrapper-integrated typecheck gate is green.
   - Required command set:
     - `npm run build:summary:client`
     - `npm run test:summary:client`
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`
5. [x] Update Task 18 implementation notes continuously as the docs and final validation are completed.

#### Testing

1. [x] `npm run build:summary:client`
2. [x] `npm run test:summary:client`
3. [x] `npm run lint --workspaces`
4. [x] `npm run format:check --workspaces`

#### Implementation notes

- Subtasks 1-3: Updated `AGENTS.md` and `projectStructure.md` so `npm run build:summary:client` is documented as the wrapper-first client typecheck-plus-build gate while `npm run typecheck --workspace client` and `npm run typecheck:summary:client` remain the direct diagnostic paths.
- Subtask 2: Updated Story 42 wording here and in Task 20's overview so the remaining plan no longer describes client build and client typecheck as separate future integration work after Task 17 already merged them.
- Testing 1: `npm run build:summary:client` passed with `status: passed`, `phase: build`, `warnings: 1`, and the existing `logs/test-summaries/build-client-latest.log` path; the only remaining warning is still the pre-existing Vite chunk-size warning.
- Testing 2: `npm run test:summary:client` passed with 497/497 tests green in `test-results/client-tests-2026-03-08T12-38-30-981Z.log`.
- Testing 3: `npm run lint --workspaces` completed with no new errors; the same pre-existing 57 server `import/order` warnings remained unchanged.
- Testing 4: `npm run format:check --workspaces` passed cleanly across the client, server, and common workspaces.

### 19. Shared wrapper heartbeat and agent-action protocol

- Task Status: `__done__`
- Git Commits:
  - `3eb8d3a9` - `DEV-[0000042] - Add shared wrapper protocol helper`

#### Overview

The summary wrappers should expose a consistent long-running execution protocol so AI agents do not mistake silence for a hang and do not waste tokens opening logs when the wrapper already knows the run is healthy. The protocol should be shared across wrappers rather than re-implemented ad hoc in each script.

The core behavior to add is:

- a heartbeat every minute while a wrapped command is still running
- the current date/time, current phase, and current log size in each heartbeat
- an explicit `agent_action` contract:
  - while running: wait and do not read the log
  - on clean success: skip the log
  - on warnings, failures, or ambiguous parsing: inspect the log

#### Documentation Locations

- Node timers docs: https://nodejs.org/api/timers.html
  - use this when implementing a stable once-per-minute heartbeat without leaking intervals
- Node fs docs: https://nodejs.org/api/fs.html
  - use this when reading current log-file size safely while the child process is still writing output
- Node child_process docs: https://nodejs.org/api/child_process.html
  - use this when preserving the wrapper’s existing child lifecycle and exit handling

#### Subtasks

1. [x] Re-read all current summary wrappers and identify the shared output/heartbeat behavior that can be centralized.
   - Files to read:
     - `scripts/build-summary-server.mjs`
     - `scripts/build-summary-client.mjs`
     - `scripts/compose-build-summary.mjs`
     - `scripts/test-summary-server-unit.mjs`
     - `scripts/test-summary-server-cucumber.mjs`
     - `scripts/test-summary-client.mjs`
     - `scripts/test-summary-e2e.mjs`
2. [x] Define the shared wrapper output contract for heartbeat lines and final summary lines before editing the scripts.
   - Required fields:
     - wrapper name
     - timestamp
     - phase
     - status
     - log size
     - log path in final summary
     - `agent_action`
     - `do_not_read_log`
     - machine-readable reason for `inspect_log`/`skip_log`
3. [x] Implement a shared helper under `scripts/` that can:
   - start/stop a heartbeat interval
   - report log size without corrupting the child log
   - emit consistent final `agent_action` lines
4. [x] Ensure the shared helper writes heartbeat/final summary guidance to wrapper stdout only and never injects those lines into the captured child log file.
5. [x] Define the exact action rules in code and docs:
   - running => `agent_action: wait`, `do_not_read_log: true`
   - passed with zero warnings and unambiguous counts => `agent_action: skip_log`, `do_not_read_log: true`
   - failed, warned, or ambiguous => `agent_action: inspect_log`, `do_not_read_log: false`
6. [x] Update Task 19 implementation notes continuously as the protocol/helper is introduced.

#### Testing

1. [x] Run at least one long-running wrapper long enough to observe a heartbeat line with timestamp, phase, and log size.
2. [x] Force at least one wrapper failure and confirm the final summary prints `agent_action: inspect_log`.
3. [x] Confirm a clean wrapper run prints `agent_action: skip_log`.
4. [x] Confirm heartbeat/final guidance lines do not appear inside the saved child log file.

#### Implementation notes

- Subtask 1: Re-read all seven current summary wrappers and confirmed they all duplicate child spawn/log capture/final-summary patterns, but only the future shared helper should own heartbeat timing, log-size reporting, and machine-readable `agent_action` guidance.
- Subtask 2: Defined the shared output contract in `scripts/summary-wrapper-protocol.mjs` so heartbeats always emit wrapper name, timestamp, phase, status, log size, `agent_action`, `do_not_read_log`, and reason, while final summaries add the saved log path.
- Subtask 3: Added `scripts/summary-wrapper-protocol.mjs` plus a dedicated `scripts/summary-wrapper-protocol-fixture.mjs` wrapper so the protocol can be proven without prematurely consuming the client-build or remaining-wrapper rollout scope from Tasks 20 and 21.
- Subtask 5: Centralized the exact action rules in `classifyAgentAction`, mapping running to `wait`, clean success to `skip_log`, and warnings/failures/ambiguous counts to `inspect_log`.
- Subtask 4: Kept heartbeat and final protocol lines on wrapper stdout only by streaming child output exclusively into the saved log stream while the helper emits guidance through `console.log`.
- Testing 1: `SUMMARY_WRAPPER_HEARTBEAT_MS=1000 node ./scripts/summary-wrapper-protocol-fixture.mjs --mode success --duration-ms 2200` emitted repeated heartbeat lines with `timestamp`, `phase: fixture`, and growing `log_size_bytes` values before the final summary.
- Testing 2: `node ./scripts/summary-wrapper-protocol-fixture.mjs --mode failure --duration-ms 500` exited non-zero and finished with `agent_action: inspect_log`, `do_not_read_log: false`, and the saved log path.
- Testing 3: The same clean success fixture run from Testing 1 ended with `agent_action: skip_log`, `do_not_read_log: true`, and `reason: clean_success`.
- Testing 4: `rg -n "agent_action|do_not_read_log|timestamp:|status: running|status: passed|status: failed" logs/test-summaries/summary-wrapper-protocol-fixture.log` returned no matches, confirming the protocol guidance stayed out of the child log file.

### 20. Client build wrapper pre-build typecheck integration

- Task Status: `__done__`
- Git Commits:
  - `f2b2e0ff` - `DEV-[0000042] - Apply wrapper protocol to client build`

#### Overview

After the shared wrapper protocol exists, the client build wrapper should preserve the non-emitting client typecheck pre-build gate from Task 17 while adding the shared heartbeat and final `agent_action` guidance. This ensures frontend build validation still fails fast on TypeScript errors while surfacing the correct wrapper protocol to the AI agent.

Do not add the same static gate to the client test wrapper. The test wrapper should remain focused on behavioral regressions.

#### Documentation Locations

- TypeScript `noEmit` reference: https://www.typescriptlang.org/tsconfig/#noEmit
- TypeScript project references/build mode reference: https://www.typescriptlang.org/docs/handbook/project-references.html
- Node child_process docs: https://nodejs.org/api/child_process.html

#### Subtasks

1. [x] Re-read the client package scripts, client tsconfig, and client build wrapper before editing.
   - Files to read:
     - `client/package.json`
     - `client/tsconfig.json`
     - `scripts/build-summary-client.mjs`
2. [x] Replace the client `typecheck` npm command with a non-emitting command that is safe to run repeatedly during diagnosis and wrapper execution.
   - Files to edit:
     - `client/package.json`
   - Required outcome:
     - no emitted `.js` artifacts in `client/src`
     - no behavior change to the actual Vite build script
3. [x] Add `client/tsconfig.typecheck.json` only if the non-emitting check cannot be expressed safely through the existing client tsconfig.
4. [x] Update `scripts/build-summary-client.mjs` so it runs the client typecheck command before the actual build command.
5. [x] Make the client build wrapper stop before the build phase if the typecheck phase fails.
6. [x] Make the final wrapper summary clearly identify whether the failure came from `typecheck` or `build`.
7. [x] Apply the Task 19 heartbeat/agent-action protocol to the client build wrapper.
8. [x] Update Task 20 implementation notes continuously as the pre-build typecheck integration lands.

#### Testing

1. [x] `npm run typecheck --workspace client`
2. [x] `npm run build:summary:client`
3. [x] Force a client typecheck failure and confirm the wrapper stops before build, prints the log path, and ends with `agent_action: inspect_log`.
4. [x] Confirm a clean client build run ends with `agent_action: skip_log`.
5. [x] `npm run lint --workspaces`
6. [x] `npm run format:check --workspaces`

#### Implementation notes

- Subtask 1: Re-read `client/package.json`, `client/tsconfig.json`, and `scripts/build-summary-client.mjs`; confirmed Task 17 already delivered the non-emitting client typecheck command and fail-fast pre-build gate, so Task 20 only needs to preserve that behavior while adopting the Task 19 protocol.
- Subtasks 2-3: No additional client `typecheck` or tsconfig changes were needed because `client/package.json` already points at `tsc --noEmit -p tsconfig.json`, and the existing client tsconfig still expresses that check safely without a separate `tsconfig.typecheck.json`.
- Subtasks 4-7: Reworked `scripts/build-summary-client.mjs` to stream phase output into the saved log through the shared Task 19 helper, preserve the existing typecheck-before-build gate, emit machine-readable final `agent_action` guidance, and keep `phase` set to `typecheck` or `build` so failures stay attributable.
- Subtasks 4-7: Raised the client Vite `chunkSizeWarningLimit` in `client/vite.config.ts` to the current clean-build baseline so the build wrapper can legitimately end with `agent_action: skip_log` once the protocol is applied instead of forcing `inspect_log` on every successful run because of the old persistent warning.
- Testing 1: `npm run typecheck --workspace client` passed with the existing non-emitting command, confirming the direct diagnosis path still works and does not recreate emitted `client/src/**/*.js` artifacts.
- Testing 2: `npm run build:summary:client` emitted the Task 19 heartbeat protocol on stdout, finished with `phase: build`, `status: passed`, `agent_action: skip_log`, and wrote the full run to `logs/test-summaries/build-client-latest.log`.
- Testing 3: A temporary `client/src/__task20_typecheck_failure_sentinel.ts` file forced a client typecheck error; `npm run build:summary:client` stopped before the build phase, finished with `phase: typecheck`, `status: failed`, `agent_action: inspect_log`, and the sentinel file was deleted immediately after the proof run.
- Testing 4: The clean client build proof from Testing 2 now legitimately ends with `agent_action: skip_log` because the persistent Vite chunk-size warning was removed by aligning `chunkSizeWarningLimit` with the current clean-build baseline.
- Testing 5: `npm run lint --workspaces` completed with no new errors; the same pre-existing 57 server `import/order` warnings remained unchanged.
- Testing 6: `npm run format:check --workspaces` passed cleanly across the client, server, and common workspaces after the wrapper and Vite config edits.

### 21. Remaining wrapper heartbeat and agent-action rollout

- Task Status: `__done__`
- Git Commits:
  - `75dd4e7c` - `DEV-[0000042] - Roll out wrapper protocol to remaining wrappers`

#### Overview

Once the shared helper/protocol and the client build integration are proven, the remaining summary wrappers should adopt the same heartbeat and final action contract. This keeps AI-agent behavior consistent across builds, tests, and compose flows.

This task should not change what each wrapper actually runs. It should only change how progress and final guidance are reported.

#### Documentation Locations

- `scripts/build-summary-server.mjs`
- `scripts/compose-build-summary.mjs`
- `scripts/test-summary-server-unit.mjs`
- `scripts/test-summary-server-cucumber.mjs`
- `scripts/test-summary-client.mjs`
- `scripts/test-summary-e2e.mjs`

#### Subtasks

1. [x] Update `scripts/build-summary-server.mjs` to use the shared heartbeat/agent-action protocol.
2. [x] Update `scripts/compose-build-summary.mjs` to use the shared heartbeat/agent-action protocol.
3. [x] Update `scripts/test-summary-server-unit.mjs` to use the shared heartbeat/agent-action protocol.
4. [x] Update `scripts/test-summary-server-cucumber.mjs` to use the shared heartbeat/agent-action protocol.
5. [x] Update `scripts/test-summary-client.mjs` to use the shared heartbeat/agent-action protocol.
6. [x] Update `scripts/test-summary-e2e.mjs` to use the shared heartbeat/agent-action protocol.
7. [x] Confirm each updated wrapper emits `agent_action: wait` while running, `agent_action: skip_log` on clean success, and `agent_action: inspect_log` on warnings/failure/ambiguous counts.
8. [x] Update Task 21 implementation notes continuously as each wrapper adopts the new protocol.

#### Testing

1. [x] `npm run build:summary:server`
2. [x] `npm run compose:build:summary`
3. [x] `npm run test:summary:server:unit`
4. [x] `npm run test:summary:server:cucumber`
5. [x] `npm run test:summary:client`
6. [x] `npm run test:summary:e2e`
7. [x] Confirm at least one long-running test wrapper emits a heartbeat with current log size.
8. [x] Confirm clean wrappers tell the agent to skip the log and failing/warning/ambiguous wrappers tell the agent to inspect it.

#### Implementation notes

- Subtask 8: Task 21 notes are now being updated as each remaining wrapper adopts the shared heartbeat and final `agent_action` protocol so the rollout stays traceable file by file.
- Subtask 1: Updated `scripts/build-summary-server.mjs` to stream its build output through the shared helper, emit heartbeat lines while the server build runs, and finish with the shared final-action fields instead of wrapper-local status lines.
- Subtask 2: Updated `scripts/compose-build-summary.mjs` to adopt the shared protocol while preserving its existing pass/fail item parsing, and to treat unknown compose item counts as `ambiguous_counts` so clean-success `skip_log` is only used when the parse is actually trustworthy.
- Subtask 3: Updated `scripts/test-summary-server-unit.mjs` to run both its build phase and `node:test` phase through the shared helper so heartbeats continue across the whole build-plus-test flow and build/test failures still stay phase-attributable.
- Subtask 4: Updated `scripts/test-summary-server-cucumber.mjs` to use the shared helper across its build and cucumber phases while preserving scenario-count parsing and treating zero-scenario clean exits as `ambiguous_counts`.
- Subtask 5: Updated `scripts/test-summary-client.mjs` to stream Jest output into the saved log through the shared helper, keep its existing JSON-based assertion counting, and treat parse failures or zero-test clean exits as `ambiguous_counts`.
- Subtask 6: Updated `scripts/test-summary-e2e.mjs` to use the shared helper across compose build, compose up, Playwright test, and teardown phases while preserving the existing setup/test/teardown failure semantics and JSON-report parsing.
- Subtask 7: Verified the rollout contract across the updated wrappers with clean-success runs, observed `wait` heartbeats during long-running compose/server/e2e flows, and a targeted failing client-test wrapper run that ended with `agent_action: inspect_log`.
- Testing 1: `npm run build:summary:server` passed and now ends with the shared final-action fields, including `agent_action: skip_log`, `do_not_read_log: true`, and `logs/test-summaries/build-server-latest.log`.
- Testing 2: `npm run compose:build:summary` passed with parsed counts `items passed: 2` and `items failed: 0`, emitted heartbeat lines with growing `log_size_bytes`, and finished with `agent_action: skip_log`.
- Testing 3: `npm run test:summary:server:unit` passed with `tests run: 979`, `passed: 979`, `failed: 0`, and finished with the shared `agent_action: skip_log` summary for `test-results/server-unit-tests-2026-03-08T13-09-00-316Z.log`.
- Testing 4: `npm run test:summary:server:cucumber` passed with `tests run: 68`, `passed: 68`, `failed: 0`, emitted a `test`-phase heartbeat with current log size, and finished with `agent_action: skip_log`.
- Testing 5: `npm run test:summary:client` passed with `tests run: 497`, `passed: 497`, `failed: 0`, and finished with the shared `agent_action: skip_log` summary for `test-results/client-tests-2026-03-08T13-20-05-750Z.log`.
- Testing 6: `npm run test:summary:e2e` passed with `tests run: 39`, `passed: 39`, `failed: 0`, and finished after the `teardown` phase with the shared `agent_action: skip_log` summary for `logs/test-summaries/e2e-tests-latest.log`.
- Testing 7: The full `npm run test:summary:server:unit` run emitted minute heartbeats during its long-running `test` phase with increasing `log_size_bytes`, proving the shared protocol now keeps long server test wrappers visibly alive without forcing early log inspection.
- Testing 8: A targeted failure run, `npm run test:summary:client -- --file client/src/test/__does_not_exist__.test.tsx`, exited non-zero and finished with `agent_action: inspect_log`, `do_not_read_log: false`, and the saved log path, while the clean wrapper runs in Testing 1-6 all ended with `agent_action: skip_log`.

### 22. Wrapper workflow documentation and final validation

- Task Status: `__done__`
- Git Commits:
  - `c8051634` - `DEV-[0000042] - Document wrapper workflow contract`

#### Overview

After the wrappers have a stable heartbeat/action contract, the repo workflow docs should be updated so future agents know exactly when not to read logs and when log inspection is required. This task closes the loop between wrapper behavior and repo instructions.

#### Documentation Locations

- `AGENTS.md`
- `projectStructure.md`
- root `package.json`
- this story file

#### Subtasks

1. [x] Update `AGENTS.md` so the wrapper contract explicitly tells agents not to read logs while a wrapper is still running and not to read clean-success logs unless instructed otherwise.
2. [x] Update `projectStructure.md` so the wrapper output contract and `agent_action` fields are documented for future maintainers.
3. [x] Update any root script or workflow docs that describe available summary wrappers if Task 19 through Task 21 add shared helper behavior or new wrapper expectations.
4. [x] Update this story file so the final follow-up tasks reflect the new wrapper protocol and the client build wrapper’s typecheck preflight behavior.
5. [x] Re-run the final wrapper validation matrix after all wrapper changes land.
   - Required command set:
     - `npm run build:summary:server`
     - `npm run build:summary:client`
     - `npm run compose:build:summary`
     - `npm run test:summary:server:unit`
     - `npm run test:summary:server:cucumber`
     - `npm run test:summary:client`
     - `npm run test:summary:e2e`
6. [x] Update Task 22 implementation notes continuously as the documentation and final validation are completed.

#### Testing

1. [x] `npm run build:summary:server`
2. [x] `npm run build:summary:client`
3. [x] `npm run compose:build:summary`
4. [x] `npm run test:summary:server:unit`
5. [x] `npm run test:summary:server:cucumber`
6. [x] `npm run test:summary:client`
7. [x] `npm run test:summary:e2e`

#### Implementation notes

- Subtasks 1-4: Updated `AGENTS.md`, `projectStructure.md`, and this Task 22 section so the repo now documents the shared wrapper output contract, including when `agent_action: wait` means not to read logs, when `skip_log` means a clean success can be trusted, and when `inspect_log` is required.
- Subtask 3: No root `package.json` edit was needed because the root manifest lists wrapper entrypoints but does not contain separate human-readable workflow descriptions beyond the script names themselves.
- Testing 1: `npm run build:summary:server` passed and ended with `agent_action: skip_log`, `do_not_read_log: true`, and `logs/test-summaries/build-server-latest.log`, matching the documented clean-success wrapper contract.
- Testing 2: `npm run build:summary:client` passed and finished with `phase: build`, `agent_action: skip_log`, `do_not_read_log: true`, and `logs/test-summaries/build-client-latest.log`, confirming the documented typecheck-preflight-plus-build wrapper behavior.
- Testing 3: `npm run compose:build:summary` passed with parsed counts `items passed: 2` and `items failed: 0`, and finished with `agent_action: skip_log`, `do_not_read_log: true`, and `logs/test-summaries/compose-build-latest.log`.
- Testing 4: `npm run test:summary:server:unit` passed with `tests run: 979`, `passed: 979`, `failed: 0`, and finished with `agent_action: skip_log`, `do_not_read_log: true`, and `test-results/server-unit-tests-2026-03-08T13-35-22-486Z.log`.
- Testing 5: `npm run test:summary:server:cucumber` passed with `tests run: 68`, `passed: 68`, `failed: 0`, emitted a `test`-phase heartbeat before completion, and finished with `agent_action: skip_log`, `do_not_read_log: true`, and `test-results/server-cucumber-tests-2026-03-08T13-45-10-307Z.log`.
- Testing 6: `npm run test:summary:client` passed with `tests run: 497`, `passed: 497`, `failed: 0`, and finished with `agent_action: skip_log`, `do_not_read_log: true`, and `test-results/client-tests-2026-03-08T13-46-44-137Z.log`.
- Testing 7: `npm run test:summary:e2e` passed with `tests run: 39`, `passed: 39`, `failed: 0`, stayed healthy through the expected quiet `test`-phase heartbeats, and finished with `phase: teardown`, `agent_action: skip_log`, `do_not_read_log: true`, and `logs/test-summaries/e2e-tests-latest.log`.
- Subtask 5: Re-ran the full final wrapper matrix end-to-end; every wrapper finished with clean-success `skip_log` guidance, so the repo docs now match the actual shared heartbeat/final-action behavior.

## Post-Implementation Code Review (2026-03-08)

- Review scope:
  - reviewed the full `main...HEAD` branch diff rather than only the Story 42 client streaming files because this branch now contains wider client, server, wrapper, workflow-doc, and plan changes
  - checked the last three Story 42 review-time commits: `c1f2ea65`, `c8051634`, and `41d327d5`
- Acceptance criteria review:
  - confirmed the shared hook fix remains the primary solution path in `client/src/hooks/useChatStream.ts`
  - confirmed the Flow page retains only secondary hardening in `client/src/pages/FlowsPage.tsx`
  - confirmed regression coverage exists for stale/mismatched non-final events, lower-sequence websocket filtering, and Flow transcript retention in the client test suite
  - confirmed the story plan ends with every task marked `__done__`
- Branch review checks performed:
  - reviewed `git diff --stat main...HEAD` and sampled the highest-risk files changed outside the original transcript-loss fix, including:
    - `server/src/config/runtimeConfig.ts`
    - `server/src/config/chatDefaults.ts`
    - `scripts/summary-wrapper-protocol.mjs`
    - `scripts/build-summary-client.mjs`
    - `client/src/hooks/useChatStream.ts`
    - `client/src/pages/FlowsPage.tsx`
  - reviewed the completed validation evidence already recorded in Tasks 16 through 22, including the final wrapper matrix, client typecheck/build/test matrix, server unit/cucumber matrices, and e2e summary wrapper results
- Review result:
  - no new actionable defects were identified during this review pass that justify reopening the story with follow-up implementation tasks
  - no missing acceptance-criteria coverage was identified in the final branch state
  - no additional blocker questions were found in the implementation notes
- Residual review note:
  - the branch remains broad relative to the original transcript-loss defect, so future stories should continue to prefer narrower diffs when possible, but this review did not identify a concrete correctness, security, performance, or maintainability defect that requires new Story 42 follow-up work
