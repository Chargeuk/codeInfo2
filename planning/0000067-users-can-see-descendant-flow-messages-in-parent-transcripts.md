# Story 0000067: Users can see descendant flow messages in parent transcripts

Implementation is complete for new flow runs; older runs are excluded. The adapter identity race was fixed and its deterministic regression now passes. Final automated stress validation passed across client, server unit, server Cucumber, and e2e harnesses. Fixture-driven Chromium presentation and interaction proof passed on desktop and mobile; it used synthetic descendant data with the real built client, not a real-provider end-to-end run.

## Proposed plan

1. [x] Record ancestry for new child flows. Store one ancestor list in existing conversation metadata. Carry it through nested launches and retain it through completion and resume. Derive nesting levels from that list.
   - Implementation note: Recorded new-root markers and inherited child ancestry in trusted metadata; existing roots remain unmarked on resume. Focused ancestry/resume tests passed (7/7), including the Mongo persistence case.
2. [x] Discover descendants using existing APIs. Extend the conversation-list filter to find descendants of the selected parent. Reuse existing turn-history loading.
   - Implementation note: Added ancestor filtering to Mongo and memory list paths; descendant loading follows existing pagination and turn-history APIs. Conversation-list and repository-filter tests passed (22/22).
3. [x] Combine live messages. Reuse the existing WebSocket connection and subscriptions, with separate conversation stream state. Combine messages for display while keeping parent run/stop handling separate.
   - Implementation note: Added flow-specific per-conversation stream controllers using the existing socket; parent run-control events stay isolated and SharedTranscript keeps the parent identity. Child initialization remains stable across callback changes. Browser proof exposed an identity race that split one inflight response into two bubbles; a deterministic regression reproduced it. The adapter now waits for the stream conversation identity to commit before registering/subscribing; the regression and affected run/stop tests pass.
   - Implementation note (duplicate-history follow-up): The executed four-pair regression proved that the fourth descendant history refresh increased 8 live bubbles to 10 by duplicating the first pair. DescendantStream now opts into full-history matching in hydrateHistory, with one-to-one candidate consumption through the existing replacements map; other callers retain last-six matching and inflight/event handling is unchanged. The restored UI regression and focused one-to-one hook regression both pass (1/1 each); the stress suite also passes with client 965/965, server unit 3,104 passed and 3 skipped, Cucumber 138/138, and e2e 80/80.
   - Implementation note (descendant-history failure follow-up): DescendantStream now publishes useConversationTurns failures alongside each child transcript at `client/src/pages/useFlowDescendants.tsx:118-124`, identifying the flow and conversation in the existing descendants warning; visible-child errors are combined with discovery errors at lines 276-284. The focused warning/recovery/removal/parent-switch regressions pass (3/3; 43 filtered out). The initial stress run's server unit wrapper had one Copilot temporary-home cleanup failure (3,103 passed, 1 failed, 3 skipped); the named test then passed in isolation (1/1), and the full server unit rerun passed (3,104 passed, 3 skipped). Parent review confirmed the server test and server source are unchanged from `origin/main`; the logged line 644 is a transformed location for `agents-config-defaults.test.ts:940` setup and `:1046` cleanup. The other suites in the initial stress run passed: client 968/968, Cucumber 138/138, and e2e 80/80. No single all-suite wrapper was green because of the initial unrelated cleanup failure; current candidate proof is complete across those results and the passing full server rerun.
4. [x] Add bubble details. Show nesting level and originating flow on descendant input and response bubbles. Put full ancestry in Info, adding Info access to descendant input bubbles where needed.
   - Implementation note: Added relative level/origin headers and full ancestry in Info for both descendant bubble roles, with wrapping text. Shared transcript scroll and user-bubble tests passed (24/24); focused desktop/mobile descendant tests passed (4/4).
5. [x] Add the filter. Follow the existing bottom-bar Options pattern on desktop and mobile. Add Show descendant messages, default on, and remember the setting in browser local storage.
   - Implementation note: Added the shared desktop/mobile Options controls and a default-on browser-local display preference. The full affected Flows run/stop files passed (56/56: 42 run, including the standalone race regression, and 14 stop); full e2e passed (80/80).
6. [x] Validate the feature. The descendant-history failure follow-up focused regressions passed (3/3; 43 filtered out). Initial stress proof: builds passed (client build had one non-failing chunk-size warning), client passed 968/968, Cucumber passed 138/138, and e2e passed 80/80; server unit had 3,103 passed, 1 failed, and 3 skipped due to an unrelated Copilot temporary-home cleanup error. The exact failing server test passed in isolation (1/1), then the complete server unit rerun passed (3,104 passed, 3 skipped) using the unchanged build. The original log is `test-results/server-unit-tests-2026-10-20T23-03-12-109Z.log` around lines 75377-75384; its transformed source location corresponds to unchanged `server/src/test/unit/agents-config-defaults.test.ts` setup at line 940 and cleanup at line 1046. Thus proof is complete across the passing initial stress components and complete passing server rerun; the initial all-suite stress wrapper itself did not pass. Parent-reviewed branch diff confirms that test and `server/src/agents/service.ts` are unchanged from `origin/main`. Previous candidate evidence: duplicate-history regressions passed (four-pair UI 1/1; hook 1/1), and stress passed client 965/965, server unit 3,104 passed with 3 skipped, Cucumber 138/138, and e2e 80/80. Earlier focused validation passed: conversation-list/repository filtering (22/22), ancestry/resume (7/7), Flows run/stop (56/56: 42 run, including the standalone race regression, and 14 stop), and shared transcript (24/24). Earlier fixture-driven Chromium UI proof against the real built client passed 14/14 checks across desktop (1280x900) and mobile (390x844): combined root/child/grandchild messages and role ancestry, Info ancestry wrap (9 lines on both roles desktop; 10 user/9 assistant lines mobile), default and remembered Options toggle, completed history/reopen, flow-only deduplication, same-socket filtered continuation, parent stop identity, and preserved scrolled-away position (scroll top stayed 279 desktop and 867 mobile). Ancestry content had no horizontal overflow. Browser data was synthetic; this was not real-provider end-to-end validation. Browser proof was not rerun for either follow-up. No auth-dependent skip applied.

## Acceptance criteria

- A newly created parent run displays its own messages and responses plus those from all descendant flows, including grandchildren and deeper descendants.
- Messages appear once; aggregation uses flow conversations without also including their duplicate agent transcripts.
- Every descendant bubble shows its nesting level relative to the viewed parent and its originating flow. Parent-level bubbles need no nesting badge.
- Every descendant message's Info section shows its full ancestry, wrapping cleanly on mobile.
- The bottom bar's Additional options menu contains Show descendant messages on desktop and mobile.
- The toggle defaults to on without a saved preference and remembers subsequent choices across visits in the same browser.
- Turning it off shows parent messages only; it does not affect flow execution.
- Combined message history remains available after refresh and when reopening a completed new run.
- Incoming descendant messages respect existing scroll behaviour, including reading older messages without forced scrolling.
- Parent run/stop behaviour remains intact.
- Parallel messages may appear out of order. Exact interleaving is not guaranteed, including after reopening history.
- Older runs retain their existing presentation.

## Scope and change restrictions

- Implement only the behaviour above, with the minimum code and files necessary.
- Reuse existing metadata storage, APIs, WebSocket transport, stream handling, transcript components, responsive controls, and test infrastructure.
- Keep any new adapter specific to this feature; no general streaming framework or broad shared-hook refactor.
- No historical reconstruction, backfills, or migrations.
- No new dependencies, settings service, or cross-device preference synchronisation.
- No ordering engine, execution tree, separate filter-status indicator, or unrelated UI redesign.
- No speculative safeguards, performance projects, logging infrastructure, or theoretical fixes.
- Leave unrelated existing issues alone where this feature does not worsen their user-visible behaviour.
- Every additional change must be justified by a demonstrated requirement or blocker to these acceptance criteria.

There is no agreed numerical line limit, but the implementation should minimise added code without weakening the required behaviour or validation.
