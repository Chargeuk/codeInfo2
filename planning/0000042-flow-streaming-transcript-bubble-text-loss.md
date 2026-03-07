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

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Read the current proof test and the shared stream hook before changing code.
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
2. [ ] Update `client/src/hooks/useChatStream.ts` so stale mismatched `assistant_delta` events are rejected by inflight identity even when `status !== 'sending'`.
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
3. [ ] Add or update a structured client log line for the stale `assistant_delta` ignore path.
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
4. [ ] Update the stale `assistant_delta` regression test.
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
5. [ ] Add a matching-inflight `assistant_delta` happy-path regression.
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
6. [ ] Update `design.md` with the `assistant_delta` ownership rule and any affected shared-stream mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document that stale `assistant_delta` events must not mutate the active inflight
     - update any stream-state or websocket-flow mermaid diagram affected by the new rule
7. [ ] Update this story file’s Implementation notes for Task 1 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at http://host.docker.internal:5001. Confirm the debug console contains `chat.ws.client_assistant_delta_ignored` with `reason: 'stale_inflight'` when the stale earlier-step delta arrives, and confirm the earlier assistant bubble text stays visible with no unexpected console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 2. Shared hook fix: stale `user_turn` must not rebind the active inflight

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Read the `user_turn` branch in the shared hook and list which refs/state it mutates before changing code.
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
2. [ ] Update `client/src/hooks/useChatStream.ts` so stale mismatched `user_turn` events are ignored consistently during Flow-style idle streaming.
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
3. [ ] Add or update a structured client log line for the stale `user_turn` ignore path.
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
4. [ ] Add a stale `user_turn` regression test.
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
5. [ ] Add a same-inflight `user_turn` replay no-op test.
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
6. [ ] Re-run nearby shared-hook consumer regressions for Chat and Agents to prove the `user_turn` filtering does not break them.
   - Files to read/edit only if failures require updates:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
7. [ ] Update `design.md` with the `user_turn` ownership rule and any affected mermaid diagram for inflight transitions.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document that stale `user_turn` must not rebind active inflight ownership
     - update any transcript or inflight-transition mermaid diagram affected by this rule
8. [ ] Update this story file’s Implementation notes for Task 2 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at http://host.docker.internal:5001. Confirm the debug console contains `chat.ws.client_user_turn_ignored` with `reason: 'stale_inflight'` when a stale earlier-step `user_turn` replays, and confirm the active assistant bubble is not reset and there are no unexpected console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 3. Shared hook fix: stale non-final events beyond `assistant_delta` and `user_turn`

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Read the remaining non-final event branches in the shared hook before changing code.
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
2. [ ] Update `client/src/hooks/useChatStream.ts` so stale mismatched non-final events are ignored consistently during Flow-style idle streaming.
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
3. [ ] Add or update a structured client log line for stale non-final event ignore paths.
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
4. [ ] Add a matching-inflight `analysis_delta` happy-path test.
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
5. [ ] Add a stale `analysis_delta` regression test.
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
6. [ ] Add a matching-inflight `tool_event` happy-path test.
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
7. [ ] Add a stale `tool_event` regression test.
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
8. [ ] Add a matching-inflight `stream_warning` happy-path test.
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
9. [ ] Add a stale `stream_warning` regression test.
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
10. [ ] Add a duplicate `stream_warning` dedupe test.
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
11. [ ] Add a matching-inflight `inflight_snapshot` happy-path test.
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
12. [ ] Add a stale `inflight_snapshot` regression test.
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
13. [ ] Re-run nearby shared-hook consumer regressions for Chat and Agents to prove the broader mismatch filtering does not break them.
   - Files to read/edit only if failures require updates:
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
14. [ ] Update `design.md` with the non-final event filtering rules and any affected mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document how `analysis_delta`, `tool_event`, `stream_warning`, and `inflight_snapshot` now follow the same inflight-ownership rule
     - update any stream-event mermaid diagram affected by those rules
15. [ ] Update this story file’s Implementation notes for Task 3 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
16. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at http://host.docker.internal:5001. Confirm the debug console contains `chat.ws.client_non_final_ignored` with `eventType` values for the stale non-final events exercised in this task, and confirm visible reasoning/tool/warning/snapshot state stays correct with no unexpected console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 4. Shared hook safeguard: late `turn_final` must remain non-destructive

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Read the existing `turn_final` handling before changing code.
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
2. [ ] Update `client/src/hooks/useChatStream.ts` only as needed to preserve non-destructive late-final behavior while the stricter mismatch filtering is in place.
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
3. [ ] Add or update a structured client log line for preserved late `turn_final` handling.
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
4. [ ] Add a Chat page late-`turn_final` regression test.
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
5. [ ] Add an Agents page late-`turn_final` regression test.
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
6. [ ] Add a matching-inflight `turn_final` happy-path regression test.
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
7. [ ] Re-run shared consumer regression checks after the late-final changes.
   - Files to read/edit only if failures require updates:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
     - `client/src/test/chatPage.stream.test.tsx`
     - `client/src/test/agentsPage.streaming.test.tsx`
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
   - Use the commands in this task's `Testing` section after all Task 4 code and test-writing subtasks are complete.
   - When this subtask is complete:
     - the late-final regressions pass in chat and agents, and no shared-hook mismatch test regressed
8. [ ] Update `design.md` with the preserved late-final rule and any affected mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document why `turn_final` remains special compared with non-final event filtering
     - update any completion/finalization mermaid diagram affected by this behavior
9. [ ] Update this story file’s Implementation notes for Task 4 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at http://host.docker.internal:5001. Confirm the debug console contains `chat.ws.client_turn_final_preserved` with `reason: 'late_final_non_destructive'` when a late older final arrives, and confirm the newer visible bubble remains intact with no unexpected console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 5. Websocket sequence filtering: keep lower-sequence same-inflight events blocked

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Read the websocket sequence bookkeeping and existing stale-packet tests before changing code.
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
2. [ ] Update `client/src/hooks/useChatWs.ts` only as needed to preserve lower-sequence same-inflight filtering and sequence reset acceptance for new inflights.
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
3. [ ] Confirm and, if needed, extend the websocket stale-event log line so seq-filtered packets are visible in the browser console.
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
4. [ ] Add a websocket stale-packet regression for lower-sequence same-inflight events.
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
5. [ ] Add a sequence-boundary regression for new inflight resets versus stale prior inflight packets.
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
6. [ ] Add a downstream chat-path regression that confirms websocket filtering still supports the visible happy path.
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
7. [ ] Re-run shared consumer regression checks after the websocket sequence changes.
   - Files to read/edit only if failures require updates:
     - `client/src/test/useChatStream.inflightMismatch.test.tsx`
     - `client/src/test/useChatWs.test.ts`
     - `client/src/test/chatPage.stream.test.tsx`
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
   - Use the commands in this task's `Testing` section after all Task 5 code and test-writing subtasks are complete.
   - When this subtask is complete:
     - the transport-layer tests and downstream consumer tests all pass together
8. [ ] Update `design.md` with the websocket sequence-filtering rule and any affected mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document how lower-sequence same-inflight packets are blocked and how new inflight sequence resets are accepted
     - update any websocket event-flow mermaid diagram affected by this transport rule
9. [ ] Update this story file’s Implementation notes for Task 5 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at http://host.docker.internal:5001. Confirm the debug console contains `chat.ws.client_stale_event_ignored` with `reason: 'seq_regression'` for lower-sequence same-inflight packets, and confirm valid newer packets still update the UI with no unexpected console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 6. Flow page regression coverage for live transcript retention

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Read the Flow page websocket handling and active-conversation reset logic before adding page-level regressions.
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
2. [ ] Add a Flow-page regression test that simulates two sequential Flow step inflights and asserts the earlier assistant bubble text remains visible while the later step streams.
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
3. [ ] Add a Flow-page happy-path regression that proves the current later-step bubble still streams normally while the earlier bubble stays visible.
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
4. [ ] Add or update a structured Flow-page log line for retained live transcript visibility.
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
5. [ ] Re-run the Flow regressions and nearby Flow tests after the new page tests are added.
   - Files to read/edit only if failures require updates:
     - `client/src/test/flowsPage.test.tsx`
     - `client/src/test/flowsPage.run.test.tsx`
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
   - Use the commands in this task's `Testing` section after all Task 6 code and test-writing subtasks are complete.
   - When this subtask is complete:
     - the new Flow websocket regressions pass and no nearby Flow page tests regress
6. [ ] Update `design.md` with the Flow live transcript behavior and any affected Flow mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document the intended Flow live-stream retention behavior once step N+1 starts
     - update any Flow transcript mermaid diagram affected by this regression coverage
7. [ ] Update this story file’s Implementation notes for Task 6 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at http://host.docker.internal:5001. Confirm the debug console contains `flows.page.live_transcript_retained` with `reason: 'next_step_started'`, confirm the earlier bubble remains visible while the later step streams, and confirm there are no unexpected console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 7. Flow page secondary hardening if Task 6 still fails

- Task Status: `__to_do__`
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

1. [ ] Confirm the Task 6 live Flow regression still fails after Tasks 1–6 before touching `FlowsPage.tsx`.
   - Files to read:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/test/flowsPage.test.tsx`
   - Documentation for this subtask:
     - React Router 7: https://reactrouter.com/home
     - React Testing Library: https://testing-library.com/docs/react-testing-library/intro/
   - When this subtask is complete:
     - either the Task 6 automated regression is still failing and justifies page hardening, or you write `N/A - Task 6 automated regression passed after Tasks 1-6, so no Flow-page change was required` in this task’s Implementation notes and do not edit `FlowsPage.tsx`
2. [ ] Apply the smallest `FlowsPage` hardening needed around active conversation visibility/reset behavior.
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
3. [ ] Add or update a structured Flow-page log line for the visibility-reset safeguard.
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
4. [ ] Add a Flow-page visibility-churn regression for the Task 7 hardening only if Task 7 edits `FlowsPage.tsx`.
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
5. [ ] Add a remount/revisit regression only if the page hardening changes behavior around Flow transcript persistence across navigation.
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
6. [ ] Re-run the Flow regressions and nearby Flow tests after any page-level change.
   - Files to read/edit only if failures require updates:
     - `client/src/test/flowsPage.run.test.tsx`
     - `client/src/test/flowsPage.test.tsx`
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
   - Use the commands in this task's `Testing` section after all Task 7 code and test-writing subtasks are complete.
   - When this subtask is complete:
     - the page-hardening regression passes and the surrounding Flow suites still pass
7. [ ] Update `design.md` if the Flow page hardening changed the architecture or Flow behavior, including any affected mermaid diagram.
   - Files to edit:
     - `design.md`
   - Documentation for this subtask:
     - Mermaid docs: Context7 `/mermaid-js/mermaid`
   - Required content:
     - document the Flow-only safeguard only if Task 7 made a real page-level behavior change
     - update any affected Flow mermaid diagram so it matches the final implementation
8. [ ] Update this story file’s Implementation notes for Task 7 once the code and tests are complete.
   - Files to edit:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task changes client code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because client behavior changes in this task. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at http://host.docker.internal:5001. Confirm the debug console contains `flows.page.visibility_reset_guarded` with `action: 'retain_transcript'` when the active conversation temporarily disappears from `flowConversations`, and confirm the visible transcript is retained with no unexpected console errors.
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 8. Documentation and project structure updates

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Update the repo documentation so future developers can understand the root cause, the chosen fix, and the regression coverage without having to rediscover the investigation from git history or screenshots.

#### Documentation Locations

- Markdown basic syntax: https://www.markdownguide.org/basic-syntax/
  - use this for updating README, design, and project structure files in the style already used by the repo
- Mermaid docs: https://mermaid.js.org/intro/
  - use this if the design notes need diagram updates while documenting the streaming fix

#### Subtasks

1. [ ] Update `README.md` with a short note describing the Flow live-stream transcript bug fix at a high level if the file already documents related Flow/chat streaming behavior.
   - Document name:
     - `README.md`
   - Location:
     - repo root `README.md`
   - Files to read before editing:
     - `README.md`
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
   - Description:
     - add a short high-level note about the Flow live-stream transcript fix only if the README already discusses Flow/chat streaming behavior
   - Purpose:
     - keep the top-level repo guide accurate without adding deep implementation detail
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Constraint:
     - keep the note short and only add it if it improves user/developer understanding of shared streaming behavior
2. [ ] Update `design.md` to document:
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
3. [ ] Update `projectStructure.md` for any new or renamed tests/files created by this story.
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
4. [ ] Update this story file’s Implementation notes for Task 8 once the documentation work is complete.
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
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run test:summary:client` - Use because this task updates documentation for client-facing behavior and file paths already validated by the story. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
2. [ ] `npm run compose:build:summary` - Use because this documentation task still references front-end-testable behavior. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
3. [ ] `npm run compose:up`
4. [ ] Manual Playwright-MCP check at http://host.docker.internal:5001. Confirm the documented Flow behavior, verify any referenced paths in `projectStructure.md`, and confirm the debug console shows the log markers documented in `design.md` when their corresponding events are triggered, with no unexpected console errors.
5. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 9. Final validation and acceptance check

- Task Status: `__to_do__`
- Git Commits:

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

1. [ ] Run the full relevant client regression wrappers without file filters.
   - Use `Testing` step 2 for this subtask.
   - Review after the Testing section command completes:
     - the wrapper summary in the terminal
     - the generated client log under `test-results/`
   - Purpose for this subtask:
     - this is the final automated proof that Chat, Agents, Flows, and shared hook tests still pass together after the targeted task-level work
   - Documentation for this subtask:
     - Jest 30: https://jestjs.io/docs/getting-started
2. [ ] Confirm this story remained strictly front end, so server build, unit, and cucumber wrappers were not required for the final regression pass.
   - Files to inspect:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
     - the final git diff for the story
     - any changed files under `client/`, `design.md`, `projectStructure.md`, and `README.md`
   - Purpose for this subtask:
     - prove the final regression scope matches the actual changed surfaces, so omitting server wrappers is deliberate rather than accidental
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
3. [ ] Verify the story acceptance criteria one by one against the implemented behavior and note the outcome in this story file.
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
4. [ ] Verify that websocket message shapes, REST payload shapes, and persistence storage shapes were not changed by this story.
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
5. [ ] Update `design.md` again if the final implementation introduced any last-minute architecture or behavior changes not yet documented.
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
6. [ ] Update `projectStructure.md` again if the final implementation introduced any last-minute file changes not yet documented.
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
7. [ ] Start the compose stack and perform a manual Playwright MCP check of a known multi-step Flow such as `flows/implement_next_plan.json`.
   - Files and paths to read before running:
     - `flows/implement_next_plan.json`
     - `test-results/screenshots/`
   - Required screenshots:
     - `test-results/screenshots/0000042-09-flow-before-fix-validation.png`
     - `test-results/screenshots/0000042-09-flow-during-second-step.png`
     - `test-results/screenshots/0000042-09-flow-after-completion.png`
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
8. [ ] Write a pull request summary comment covering:
   - root cause
   - files changed
   - tests run
   - residual risks if any
   - Files to edit/create as agreed by the repo workflow
   - Source material to read before writing:
     - `planning/0000042-flow-streaming-transcript-bubble-text-loss.md`
     - `design.md`
     - `projectStructure.md`
     - the final git diff for the story
   - Documentation for this subtask:
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - When this subtask is complete:
     - the summary mentions the root cause, the shared-hook-first fix, any Flow-page fallback work, and the exact validation that was run
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Do not attempt to run tests without using the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Mandatory for this final regression check because the story is front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Mandatory for this final regression check because client behavior changed. If `failed > 0`, inspect the exact log path printed by the summary under `test-results/client-tests-*.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run test:summary:e2e` - Allow up to 7 minutes; if `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands if needed. After fixes, rerun full `npm run test:summary:e2e`.
4. [ ] `npm run compose:build:summary` - Use because this final regression check is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [ ] `npm run compose:up`
6. [ ] Manual Playwright-MCP check to confirm the story acceptance behavior, save the required screenshots, and verify the debug console shows the expected log lines from Tasks 1–7 with no unexpected `error`-level entries. Use http://host.docker.internal:5001 via the Playwright MCP tools.
7. [ ] `npm run compose:down`

#### Implementation notes

- 
