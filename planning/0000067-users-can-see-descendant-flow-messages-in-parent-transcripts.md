# Story 0000067: Users can see descendant flow messages in parent transcripts

Implementation is complete for new flow runs; older runs are excluded. The adapter identity race was fixed and its deterministic regression now passes. Final automated stress validation passed across client, server unit, server Cucumber, and e2e harnesses. Fixture-driven Chromium presentation and interaction proof passed on desktop and mobile; it used synthetic descendant data with the real built client, not a real-provider end-to-end run.

## Proposed plan

1. [x] Record ancestry for new child flows. Store one ancestor list in existing conversation metadata. Carry it through nested launches and retain it through completion and resume. Derive nesting levels from that list.
   - Implementation note: Recorded new-root markers and inherited child ancestry in trusted metadata; existing roots remain unmarked on resume. Focused ancestry/resume tests passed (7/7), including the Mongo persistence case.
2. [x] Discover descendants using existing APIs. Extend the conversation-list filter to find descendants of the selected parent. Reuse existing turn-history loading.
   - Implementation note: Added ancestor filtering to Mongo and memory list paths; descendant loading follows existing pagination and turn-history APIs. Conversation-list and repository-filter tests passed (22/22).
3. [x] Combine live messages. Reuse the existing WebSocket connection and subscriptions, with separate conversation stream state. Combine messages for display while keeping parent run/stop handling separate.
   - Implementation note: Added flow-specific per-conversation stream controllers using the existing socket; parent run-control events stay isolated and SharedTranscript keeps the parent identity. Child initialization remains stable across callback changes. Browser proof exposed an identity race that split one inflight response into two bubbles; a deterministic regression reproduced it. The adapter now waits for the stream conversation identity to commit before registering/subscribing; the regression and affected run/stop tests pass.
4. [x] Add bubble details. Show nesting level and originating flow on descendant input and response bubbles. Put full ancestry in Info, adding Info access to descendant input bubbles where needed.
   - Implementation note: Added relative level/origin headers and full ancestry in Info for both descendant bubble roles, with wrapping text. Shared transcript scroll and user-bubble tests passed (24/24); focused desktop/mobile descendant tests passed (4/4).
5. [x] Add the filter. Follow the existing bottom-bar Options pattern on desktop and mobile. Add Show descendant messages, default on, and remember the setting in browser local storage.
   - Implementation note: Added the shared desktop/mobile Options controls and a default-on browser-local display preference. The full affected Flows run/stop files passed (56/56: 42 run, including the standalone race regression, and 14 stop); full e2e passed (80/80).
6. [x] Validate the feature. Focused validation passed: conversation-list/repository filtering (22/22), ancestry/resume (7/7), Flows run/stop (56/56: 42 run, including the standalone race regression, and 14 stop), and shared transcript (24/24). The final stress suite passed: client 963/963, server unit 3,104 passed with 3 skipped, server Cucumber 138/138, and e2e 80/80. Fixture-driven Chromium UI proof against the real built client passed 14/14 checks across desktop (1280x900) and mobile (390x844): combined root/child/grandchild messages and role ancestry, Info ancestry wrap (9 lines on both roles desktop; 10 user/9 assistant lines mobile), default and remembered Options toggle, completed history/reopen, flow-only deduplication, same-socket filtered continuation, parent stop identity, and preserved scrolled-away position (scroll top stayed 279 desktop and 867 mobile). Ancestry content had no horizontal overflow. Browser data was synthetic; this was not real-provider end-to-end validation. No auth-dependent skip applied.

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
