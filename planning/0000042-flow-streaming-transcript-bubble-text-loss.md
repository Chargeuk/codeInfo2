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
- The fix applies to the shared client streaming path, not just a one-off visual workaround in the Flow page, unless later investigation proves the root cause is page-local.
- The implementation prevents stale or mismatched non-final websocket events from mutating the active assistant bubble state for a different inflight run.
- Existing late/out-of-band `turn_final` handling remains non-destructive. The fix must not reintroduce the older race where valid finalization for an earlier inflight damages a newer one.
- Chat and Agents streaming behavior does not regress. If the shared hook is changed, existing Chat/Agents protections must keep passing.
- The story adds regression coverage for the exact failure class:
  - hook-level stale `assistant_delta` while Flow-style lifecycle is `idle`
  - hook-level stale `analysis_delta` and `tool_event` for the same mismatch pattern
  - a Flow page integration test showing that earlier bubble text remains visible while the next step streams
- API contracts, websocket event schema, and persistence/Mongo document shapes remain unchanged in this story.
- The plan documents enough implementation guidance that a junior developer can identify:
  - the most likely root cause
  - the files most likely to change
  - the minimum regression tests that must be added
  - the difference between the primary fix and any secondary Flow-page hardening

### Out Of Scope

- Changing server API shapes, websocket event names, or Mongo persistence schema as part of the first-pass fix.
- Rewriting Flow transcript rendering or redesigning bubble layout/styling.
- Solving unrelated Flow sidebar/filtering issues unless they are still needed as a small secondary safeguard after the primary `useChatStream` fix lands.
- Adding synthetic Flow-only `sending` state just to activate existing guards. The plan’s current recommendation is to fix inflight safety directly instead.
- Implementing code fixes in this planning story.
- Running wrapper tests/builds/system commands for validation in this planning story.
- UX redesign of bubble layout/styling unrelated to this streaming state defect.

### Questions

- None. The initial investigation questions have been answered and converted into implementation guidance below.

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

- Remaining known uncertainty:
  - `FlowsPage` has a separate conversation-visibility reset path tied to `flowConversations`. That logic may still cause additional transient UI loss even after the primary hook fix lands.
  - Based on current evidence, this should stay a secondary safeguard within the same story only if residual text disappearance remains after the `useChatStream` fix and regression tests.

- Tool availability note:
  - DeepWiki MCP is not currently usable for this repository because the repo is not indexed there.
  - Context7 was attempted for React/Codex reference material, but the configured Context7 access failed during this pass, so primary web sources and direct code inspection were used instead.

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

- Candidate implementation directions for follow-up tasking:
  - Option A (preferred first pass):
    - In `useChatStream`, always isolate or ignore mismatched inflight deltas and tool/reasoning events independent of `status`.
    - Keep `turn_final` out-of-band completion behavior explicit and non-destructive.
  - Option B:
    - Track stream state per inflight ID instead of shared refs to remove cross-inflight mutation risk.
  - Option C (defense-in-depth):
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
    - Flow conversation visibility reset logic should be hardened as a secondary safeguard, but it should not be treated as the primary fix for this story.
    - Why this is needed:
      - Flow still has a separate transcript-clearing path when the active conversation falls out of the filtered list.
      - That behavior can amplify confusion during websocket/sidebar churn even if the core inflight bug is fixed.
    - Why this is the best option:
      - It reduces additional transient UI loss without distracting from the primary corruption fix.
      - It keeps the implementation layered: first stop wrong-stream writes, then reduce unnecessary resets.

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
    - Reassess Flow page reset hardening only after the source-level fix lands.
    - Why fourth:
      - The product should avoid papering over corrupted upstream state with downstream workarounds.
      - If residual Flow-only transcript clearing remains after the hook fix, it can be handled as a secondary safeguard with clearer signal.

- Explicit recommendation:
  - Use a KISS-but-correct approach:
    - fix the source defect in `useChatStream`,
    - avoid synthetic Flow-only state tricks such as forcing a fake `sending` state,
    - avoid starting with component-level defensive patches for data that should never have been corrupted upstream.
  - Why this is the recommended approach:
    - It aligns with product robustness and stability goals.
    - It reduces long-term maintenance cost by enforcing a correct invariant at the shared stream-state layer.
    - It keeps downstream pages simpler and avoids spreading compensating logic through Flow-specific UI code unless evidence later shows a separate UI reset bug remains.
