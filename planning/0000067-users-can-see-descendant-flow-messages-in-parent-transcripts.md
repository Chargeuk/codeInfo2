# Story 0000067: Users can see descendant flow messages in parent transcripts

Planned; implementation has not started. Applies only to new flow runs created after the feature is introduced; older runs are excluded.

## Proposed plan

1. Record ancestry for new child flows. Store one ancestor list in existing conversation metadata. Carry it through nested launches and retain it through completion and resume. Derive nesting levels from that list.
2. Discover descendants using existing APIs. Extend the conversation-list filter to find descendants of the selected parent. Reuse existing turn-history loading.
3. Combine live messages. Reuse the existing WebSocket connection and subscriptions, with separate conversation stream state. Combine messages for display while keeping parent run/stop handling separate.
4. Add bubble details. Show nesting level and originating flow on descendant input and response bubbles. Put full ancestry in Info, adding Info access to descendant input bubbles where needed.
5. Add the filter. Follow the existing bottom-bar Options pattern on desktop and mobile. Add Show descendant messages, default on, and remember the setting in browser local storage.
6. Validate the feature. Extend existing tests for nested messages, live updates, saved history, filtering, and metadata. Check desktop/mobile presentation and existing scroll behaviour using the current testing infrastructure. Follow repository validation rules when implementation is authorized; do not execute that work now.

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
