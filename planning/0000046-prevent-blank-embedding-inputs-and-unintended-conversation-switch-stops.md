# Story 0000046 – Prevent Blank Embedding Inputs And Unintended Conversation Switch Stops

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. Once all questions are resolved, the section should either be empty or contain only `- No Further Questions` before creating tasks.

### Description

Two separate user-facing reliability problems have been observed in the current product.

The first problem affects repository ingest when embedding text for vector storage. Users have seen OpenAI embedding requests fail because the system sometimes tries to embed empty strings or strings that contain only whitespace. When that happens, the ingest run can fail even though the repository content itself is otherwise valid. The same ingest work often appears to succeed with LM Studio, which makes the behavior look provider-specific, but that is misleading. The current system is producing invalid embedding inputs before the provider-specific call happens, and OpenAI is simply surfacing the bug more clearly than LM Studio does.

For this story, the product behavior is intentionally small and consistent with the existing ingest contract:

- a fresh ingest that produces zero embeddable chunks after blank filtering should fail with the existing clear product-owned "no eligible files" style error rather than pretending that zero embeddings is a successful ingest;
- that blank-only fresh-ingest failure should leave no new vectors and no new completed root summary written for that run;
- the existing delta re-embed no-op and deletions-only semantics from Story 0000020 should remain intact rather than being redesigned here.

The second problem affects the web chat experience. When a user is in an active conversation and clicks another conversation in the Conversations sidebar, the conversation they were on stops as though the user had pressed the Stop button. That is not the intended product behavior. A conversation should continue running until it finishes naturally or until the user explicitly presses Stop. Merely changing which conversation is visible in the UI should not send a cancellation request to the server.

The same product rule should apply consistently to the closely related Chat actions that currently behave like navigation or local reset rather than an explicit stop: Chat "New conversation" and Chat provider-change flows. Those actions should not send cancellation requests either. They should create or switch the local visible conversation while any previously active run continues until it finishes or the user explicitly presses Stop.

For this story, the expected user-visible output for those Chat actions is:

- selecting another conversation shows that conversation's own existing transcript and inflight state only; it must not show stopping, stopped, or newly streamed assistant content from the previously active conversation;
- when another conversation is selected, the newly visible conversation should be locally interactive for its own state: it must not stay disabled, stopping, or spinner-locked just because a different hidden conversation is still running;
- clicking Chat "New conversation" while another run is active opens a clean draft conversation view for the next message without cancelling the older run; if the user later returns to the older conversation, its server-side progress or final answer is still there;
- that new draft conversation view should show an empty transcript placeholder and normal composer/send readiness for the next user message rather than inheriting a sending/stopping state from the older run;
- changing provider or model while another run is active updates only the selection that will be used for the next send; it must not cancel, restart, or silently mutate the run that is already in flight.

These problems are related at a product level because both are cases where the system is being too permissive at the wrong boundary:

- ingest accepts invalid text into the embedding pipeline instead of rejecting or filtering it at the shared core boundary;
- chat navigation triggers cancellation at a view-switching boundary even though cancellation should only occur at an explicit user-stop boundary.

From the user point of view, the desired outcomes are:

- ingest should never send empty or whitespace-only text to any embedding provider, regardless of whether the selected provider is OpenAI, LM Studio, or a future provider;
- conversation switching in the web UI should behave like viewing a different thread, not like stopping the previously active thread;
- Chat "New conversation" and provider-change actions should behave like local navigation or reset, not like an implicit stop for the previous run;
- the explicit Stop button should continue to work exactly as the authoritative cancellation action.

This story is therefore about correctness of shared boundaries:

- the shared ingest boundary that turns file text into embeddable chunks;
- the shared UI/server cancellation boundary that determines when a run should actually be stopped.

### Acceptance Criteria

- Repository ingest never sends empty strings or whitespace-only strings to any embedding provider.
- The fix applies at a shared boundary so it protects all embedding solutions, not only OpenAI.
- Empty files, whitespace-only files, and files with leading blank lines do not produce provider embedding requests for blank text.
- Normal files still preserve their meaningful chunk content and chunk ordering after the fix.
- If a fresh ingest path produces zero embeddable chunks after blank filtering, the run fails with the existing clear product-owned "no eligible files" style error rather than completing successfully with zero embeddings.
- The fresh-ingest zero-embeddable-chunks failure rule applies even when file discovery succeeded; in other words, finding files is not enough if blank filtering leaves nothing valid to embed.
- If blank filtering leaves a fresh ingest with zero embeddable chunks, the run does not persist partial vector rows or a completed root summary for that failed run.
- Existing Story 0000020 delta re-embed no-op and deletions-only behavior remains unchanged for this story.
- If a blank embedding input somehow reaches the provider layer after the shared ingest fix, the provider layer rejects it with one clear product-owned error path that the product controls and can test, rather than surfacing a raw provider-SDK-specific validation message as the only explanation.
- If the defensive provider-layer blank-input guard is hit, the run fails clearly instead of silently skipping the offending input and continuing.
- OpenAI ingest no longer fails because the product generated blank embedding inputs internally.
- LM Studio ingest behavior remains supported and does not regress.
- Selecting a different conversation from the Conversations sidebar does not send a stop or cancel request for the previously active run.
- The previously active run continues server-side after sidebar selection until it finishes naturally or the user explicitly presses Stop.
- Chat "New conversation" does not send a stop or cancel request for the previously active run.
- Chat provider-change does not send a stop or cancel request for the previously active run.
- If the user changes provider or model while a run is already active, that new selection affects only the next send and does not alter the provider/model used by the already-running request.
- The newly visible conversation or new draft conversation does not inherit `sending`, `stopping`, or disabled-composer state from a different hidden conversation that is still running.
- The Stop button continues to send the real cancellation request and continues to drive the existing stopping and stopped UX.
- Switching the visible conversation only clears or rehydrates local view state for the newly selected conversation and does not invent terminal events, stop banners, or completed assistant messages for the previously active conversation.
- Late websocket events from a still-running non-visible conversation do not corrupt the newly selected conversation view; they are ignored by the currently visible Chat view unless the user switches back to the conversation they belong to.
- Chat behavior is aligned with the already-accepted Agents behavior where active conversation switching is allowed without forcing cancellation.
- Chat "New conversation" and provider-change flows also stop cancelling runs implicitly and rely on explicit Stop instead.
- This story does not introduce a new websocket cancellation protocol; `cancel_inflight` remains the only client-to-server stop message and `unsubscribe_conversation` remains a subscription-only action.
- Automated coverage is added or updated for all of the following: blank chunk filtering, provider-layer blank-input rejection, sidebar conversation switching without `cancel_inflight`, Chat "New conversation" without `cancel_inflight`, provider/model change during an active run without `cancel_inflight`, and the explicit Stop button still sending the real cancellation request.

### Out Of Scope

- Redesigning chunking heuristics beyond what is required to prevent blank embedding inputs.
- Changing chunk content for non-blank text just to normalize formatting or whitespace style.
- Replacing the existing ingest architecture or vector store.
- Changing provider authentication, retry policy, or rate-limit behavior beyond what is required to handle blank-input validation cleanly.
- Changing the existing Story 0000020 delta re-embed no-op or deletions-only terminal semantics beyond what is required to keep blank-only content out of embedding requests.
- Redesigning the chat, agents, or flows page layout.
- Changing the server-authoritative Stop contract introduced for explicit cancellation flows.
- Introducing new websocket message types or changing `unsubscribe_conversation` so it behaves like cancellation.
- Introducing multi-tab shared view state for hidden conversations beyond the existing websocket and snapshot behavior.
- Reworking unrelated conversation hydration, transcript rendering, or sidebar styling behavior.

## Documentation Sources

These are the main sources a later task-writer or implementer should treat as the story's reference bundle. They capture the current behavior that Story 0000046 is intentionally changing or intentionally preserving.

- Local ingest behavior and contracts:
  - `server/src/ingest/chunker.ts`
  - `server/src/ingest/ingestJob.ts`
  - `server/src/ingest/types.ts`
  - `server/src/ingest/providers/openaiGuardrails.ts`
  - `server/src/ingest/providers/openaiEmbeddingProvider.ts`
  - `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`
  - `server/src/ingest/providers/openaiErrors.ts`
- Local chat behavior and websocket contracts:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/hooks/useChatStream.ts`
  - `client/src/hooks/useChatWs.ts`
  - `server/src/ws/types.ts`
  - `server/src/ws/server.ts`
  - `server/src/ws/registry.ts`
- Local persistence and storage shapes to preserve:
  - `server/src/mongo/conversation.ts`
  - `server/src/mongo/turn.ts`
  - the existing Chroma metadata writes in `server/src/ingest/ingestJob.ts`
- Local tests and harnesses to mirror or extend:
  - `server/src/test/unit/chunker.test.ts`
  - `server/src/test/features/chat_cancellation.feature`
  - `server/src/test/steps/chat_cancellation.steps.ts`
  - `server/src/test/support/wsClient.ts`
  - `server/src/test/support/mockLmStudioSdk.ts`
  - `client/src/test/support/mockChatWs.ts`
  - `client/src/test/chatPage.newConversation.test.tsx`
  - `client/src/test/chatPage.provider.conversationSelection.test.tsx`
  - `client/src/test/chatPage.stop.test.tsx`
  - `client/src/test/chatPage.inflightNavigate.test.tsx`
  - `client/src/test/agentsPage.conversationSelection.test.tsx`
  - `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`
- Related story context that this story must stay aligned with:
  - Story `0000020` for delta re-embed no-change and deletions-only semantics
  - Story `0000043` for explicit stop behavior and the history of sidebar cancellation
- External contracts already used to shape this story:
  - OpenAI embeddings API reference stating embedding input cannot be an empty string
  - React guidance on preserving and resetting state when switching visible UI context

## Implementation Ideas

The rough implementation path can stay small if it follows the current repository boundaries instead of redesigning the ingest or websocket architecture. Direct source inspection shows that the likely work is concentrated in one ingest boundary, one defensive provider layer, one Chat page surface, and a small set of nearby regression tests.

### Likely file map and change shape

- Ingest chunk filtering boundary:
  - `server/src/ingest/chunker.ts`
  - Add one small shared eligibility helper such as `hasEmbeddableText(text)` or equivalent.
  - Filter blank and whitespace-only pieces before they become returned chunks.
  - Renumber `chunkIndex` after filtering so chunk hashes, ids, and metadata stay deterministic.
- Fresh-ingest zero-eligible failure boundary:
  - `server/src/ingest/ingestJob.ts`
  - Keep the existing `discoverFiles()` zero-files failure path for fresh ingest.
  - Add the second failure path after chunking so a run that discovered files but produced zero embeddable chunks still ends with the existing product-owned `NO_ELIGIBLE_FILES` style error.
  - Preserve Story 0000020 delta re-embed no-change and deletions-only early exits exactly as they already work today.
- Defensive provider guard:
  - `server/src/ingest/providers/openaiGuardrails.ts`
  - `server/src/ingest/providers/openaiEmbeddingProvider.ts`
  - `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`
  - Reuse one blank-input rule at provider entry so both OpenAI and LM Studio reject empty or whitespace-only strings before network work starts.
  - Keep this guard defensive only; the main fix still belongs in the shared chunking/ingest path.
- Chat implicit-cancel removal:
  - `client/src/pages/ChatPage.tsx`
  - Direct source inspection shows this file currently sends `cancelInflight(...)` from all three user actions this story cares about: `handleSelectConversation(...)`, `handleNewConversation(...)`, and provider/model change via `handleProviderChange(...)`.
  - The main product fix is to remove those implicit cancel sends while preserving the explicit Stop button path.
- Existing safe local reset and late-event guard:
  - `client/src/hooks/useChatStream.ts`
  - `setConversation(...)` already clears local streaming state for the newly visible conversation.
  - `handleWsEvent(...)` already ignores websocket events whose `conversationId` does not match the active conversation.
  - Rough plan implication: prefer to reuse this existing guard rather than inventing new hidden-conversation state or new websocket protocol behavior.
- Server websocket scope boundary:
  - `server/src/ws/server.ts`
  - `server/src/ws/registry.ts`
  - `server/src/test/features/chat_cancellation.feature`
  - Research shows `unsubscribe_conversation` already behaves as subscription-only and `cancel_inflight` is already the explicit stop path.
  - Rough plan implication: regression-test this contract, but do not redesign it as part of Story 0000046.

### Rough implementation sequence

1. Tighten `server/src/ingest/chunker.ts` so blank pieces never leave the chunker and chunk indexes remain sequential after filtering.
2. Update `server/src/ingest/ingestJob.ts` so fresh ingest fails cleanly when post-filter chunking yields zero embeddable chunks even though files were discovered.
3. Add the matching provider-entry guard for OpenAI and LM Studio so any future upstream breach still fails with a product-owned error.
4. Remove implicit `cancelInflight(...)` sends from the three ChatPage navigation/reset actions while leaving the explicit Stop button behavior unchanged.
5. Lean on the existing `useChatStream.ts` conversation-mismatch guard for late websocket events rather than adding new transport or server behavior.
6. Extend the nearby regression tests so the story proves both sides of the contract: blank inputs never reach providers, and only explicit Stop sends `cancel_inflight`.

### Candidate tests to extend or add

- Ingest unit coverage:
  - `server/src/test/unit/chunker.test.ts`
  - Add cases for empty string, whitespace-only input, leading blank lines before a boundary, and chunk renumbering after blank removal.
- Ingest integration or provider coverage:
  - Add or extend server tests near the ingest provider files so OpenAI and LM Studio reject blank defensive inputs with the story's product-owned error path.
  - Prefer one focused test per provider path rather than a large new suite.
- Chat page regression coverage:
  - `client/src/test/chatPage.newConversation.test.tsx`
  - This file currently asserts that New conversation cancels the active run, so it should be rewritten to assert the opposite contract for Story 0000046.
  - `client/src/test/chatPage.provider.conversationSelection.test.tsx`
  - Extend with an active-run scenario so provider/model changes update only future-send state and do not send `cancel_inflight`.
  - Add or extend one Chat conversation-selection test to mirror the existing Agents navigation pattern and prove sidebar switching no longer sends `cancel_inflight`.
  - `client/src/test/chatPage.stop.test.tsx`
  - Keep as the regression guard that explicit Stop still sends the real cancellation request.
- Existing pattern to mirror:
  - `client/src/test/agentsPage.conversationSelection.test.tsx`
  - `client/src/test/agentsPage.navigateAway.keepsRun.test.tsx`
  - These already encode the desired “navigation is not cancellation” behavior and are the best nearby examples for shaping Chat tests.
- Server websocket contract regression:
  - `server/src/test/features/chat_cancellation.feature`
  - Keep or extend this feature so unsubscribe remains non-cancelling and explicit `cancel_inflight` remains the only stop path.

- Research summary for the embedding issue:
  - `server/src/ingest/chunker.ts` currently allows blank pieces to become chunks.
  - `splitOnBoundaries()` can emit an initial blank chunk when a file starts with newline or whitespace before the first detected boundary such as `function` or `class`.
  - `discoverFiles()` currently accepts empty and whitespace-only text files, so a repository can contain files that later produce no meaningful content but still enter the embedding pipeline.
  - `server/src/ingest/ingestJob.ts` currently embeds every chunk returned by `chunkText()` without filtering blank chunk text first.
  - `server/src/ingest/providers/openaiEmbeddingProvider.ts` forwards raw inputs to `client.embeddings.create(...)`, so OpenAI surfaces the blank-input bug immediately.
  - `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` appears to tolerate blank inputs, which masks the bug instead of proving the pipeline is correct.

- Concrete research example observed during analysis:
  - `""` becomes `[""]`.
  - `"   "` becomes `["   "]`.
  - `"\nfunction alpha(){}"` becomes `["", "function alpha(){}"]`.
  - This proves normal source files can generate a blank first chunk even when the file is otherwise valid.

- Suggested shared ingest fix:
  - Make `chunkText()` drop any piece or slice whose text becomes empty after `trim()`.
  - Recompute `chunkIndex` after filtering so downstream metadata and chunk hashing remain deterministic.
  - Preserve original chunk text for non-blank chunks; use trimming only for eligibility checks, not for rewriting stored content.
  - Consider adding one small helper such as `isEmbeddableText(text)` or `hasNonWhitespaceContent(text)` in the ingest layer so the rule is centralized and readable.
  - Reuse the existing fresh-ingest "no eligible files" style error if blank filtering leaves the run with zero embeddable chunks, rather than inventing a new success contract for zero-embedding ingests.
  - Because the current ingest job only fails early when `discoverFiles()` returns zero files, implementation must also add a post-chunking / post-filtering zero-embeddable guard for fresh ingest so blank-only discovered files still terminate with the existing product-owned failure contract.
  - Trigger that fresh-ingest zero-embeddable failure before any successful root-summary completion write for the run, so the persisted ingest state cannot look completed when nothing valid was embedded.

- Suggested defensive provider fix:
  - Add one shared embedding-input guard used by all provider adapters and embedding-function implementations.
  - The guard should reject empty or whitespace-only text before any network or SDK call is made.
  - This guard should be defensive only; the primary ingest path should already have filtered the bad inputs before the provider layer is reached.
  - If this defensive guard is ever hit, fail the run with a clear product-owned error instead of silently skipping that item, because hitting the guard means an upstream invariant has already been violated.
  - The same shared guard can later protect non-ingest embedding call sites if more are added, but this story should only cover the current ingest path.

- Suggested ingest/file-handling considerations:
  - Treat whitespace-only files as non-embeddable for this story's chunking and embedding path, while preserving existing discovery and AST behavior unless a small targeted change is required.
  - Keep AST indexing behavior intentionally separate from embeddable-chunk behavior unless implementation proves both should share one text-eligibility rule.
  - Ensure start and re-embed flows both use the same blank-chunk filtering rule, while preserving Story 0000020 no-change and deletions-only semantics.

- Research summary for the conversation-switch stop issue:
  - `client/src/pages/ChatPage.tsx` currently calls `cancelInflight(...)` inside `handleSelectConversation(...)`.
  - The same file also calls `cancelInflight(...)` in Chat "New conversation" handling before resetting local state.
  - `client/src/hooks/useChatWs.ts` turns `cancelInflight(...)` into a real websocket `cancel_inflight` message.
  - `server/src/ws/server.ts` treats `cancel_inflight` as an authoritative stop request and aborts the active run.
  - This means Chat sidebar selection is currently equivalent to pressing Stop.

- Story-history research summary:
  - Git blame shows the Chat sidebar cancellation path was introduced in commit `c45d2ab2` (`DEV-[0000043] - Align Chat stop UX with shared state contract`).
  - Story `0000043-stop-any-point-cancellation.md` explicitly lists unrelated sidebar-selection bugs as out of scope, which strongly suggests the current sidebar-cancel behavior is accidental collateral rather than intended design.
  - By contrast, `client/src/pages/AgentsPage.tsx` already allows active conversation switching without sending `cancel_inflight`, and `client/src/test/agentsPage.conversationSelection.test.tsx` already asserts that no cancel message is sent during active-run conversation switching.

- Suggested chat cancellation fix:
  - Remove sidebar-triggered `cancelInflight(...)` from Chat conversation selection.
  - Keep the explicit Stop button path unchanged.
  - Align Chat with Agents and Flows, which already treat conversation selection as a local view change rather than a server stop request.
  - Also remove implicit cancellation from Chat "New conversation" and provider-change flows so Chat follows the same explicit-stop-only rule across its closely related navigation/reset actions.
  - Treat Chat "New conversation" as a local draft reset only: clear the visible draft/composer state for the new conversation, but do not cancel or rewrite the older run.
  - Treat provider/model changes during an active run as state for the next send only: do not cancel, restart, or mutate the request that is already in flight.
  - Keep the websocket protocol and server-side cancel contract unchanged: repository evidence already shows `unsubscribe_conversation` is subscription-only and `cancel_inflight` is the explicit stop path, so the main product fix belongs in Chat client handlers and regression coverage rather than in new server protocol behavior.
  - When switching to another conversation or a new draft, clear only the local inflight/sending indicators for the newly visible view; do not leave the visible composer or send controls blocked because a different hidden conversation is still running.

- Why the Chat fix should be safe:
  - `client/src/hooks/useChatStream.ts` already resets local inflight state when a new conversation is selected.
  - The same hook already ignores websocket events whose `conversationId` does not match the currently active conversation.
  - This means the UI already has the basic late-event protection needed for "old conversation keeps running while the user views a different conversation."
  - The Stop button continues to own the real cancellation path, so stop-button behavior does not need to change.

- Suggested automated coverage for embeddings:
  - Unit test for `chunkText()` with an empty string input.
  - Unit test for `chunkText()` with a whitespace-only string input.
  - Unit test for `chunkText()` with leading blank lines before the first boundary marker.
  - Unit test confirming chunk indexes are renumbered correctly after blank chunks are removed.
  - Provider-level unit test confirming the shared embedding-input guard rejects whitespace-only text for every provider adapter.
  - Ingest integration test using an OpenAI provider stub that fails if it receives a blank input, proving the shared ingest path no longer generates such requests.
  - Re-embed coverage proving the same protection exists outside the initial ingest path.

- Suggested automated coverage for conversation switching:
  - Add a Chat page test mirroring the existing Agents conversation-selection regression: active run plus sidebar switch must not send `cancel_inflight`.
  - Keep or update the existing Chat stop-button tests so they still prove explicit Stop sends the correct cancellation request.
  - Update the existing Chat "New conversation" and provider-change tests to prove they no longer send `cancel_inflight` and that the previous run can continue server-side while the visible conversation changes.
  - Add at least one assertion that a non-visible conversation's late websocket events do not render a stop banner, stopped state, or assistant content inside the currently visible conversation.
  - Preserve or extend tests that prove late websocket events from an old conversation do not alter the currently selected conversation view.

- Documentation and rollout notes:
  - Record clearly in the story tasks that the fix is intentionally shared-boundary work, not an OpenAI-only workaround.
  - Record clearly that the desired UX rule is "conversation selection is navigation, Stop is cancellation."
  - When implementation is complete, verify that the story notes explain the relationship to Story 0000043 so future work does not reintroduce sidebar-triggered stop behavior while adjusting stop-state UX.

## Research Findings

1. Repository evidence shows the ingest story needs one extra explicit boundary after chunking, not just before file discovery. `server/src/ingest/ingestJob.ts` already fails fresh ingest when `discoverFiles()` returns zero files, but `server/src/ingest/chunker.ts` can currently emit blank chunks and the ingest loop embeds every returned chunk directly. That means blank filtering can create a new case where files were discovered successfully but the run still has zero embeddable chunks. The plan now treats that as an intentional fresh-ingest failure using the existing product-owned "no eligible files" contract.
2. Repository evidence shows the server-side websocket contract is already aligned with the desired stop behavior. `server/src/ws/server.ts` handles `unsubscribe_conversation` as subscription-only and `cancel_inflight` as the explicit stop path, while `server/src/test/features/chat_cancellation.feature` already proves unsubscribe does not cancel. This means Story 0000046 should stay scoped to Chat client handlers, UI state reset behavior, and regression coverage rather than redesigning websocket protocol semantics.
3. Repository evidence shows the client already has the late-event protection this story needs. `client/src/hooks/useChatStream.ts` resets local inflight indicators when the active conversation changes and ignores websocket events whose `conversationId` does not match the currently visible conversation. That means the story does not need a new hidden-conversation state system; it needs ChatPage to stop sending `cancelInflight(...)` during navigation/reset actions and then rely on the existing conversation-mismatch guard.
4. Repository evidence shows the hidden-run rehydration interface already exists and should be reused instead of expanded. `server/src/routes/conversations.ts` already returns an optional `inflight` snapshot from `GET /conversations/:id/turns`, and `client/src/hooks/useConversationTurns.ts` already hydrates that snapshot back into client state when a conversation is revisited. That means Story 0000046 does not need a new "active run" endpoint, extra response flag, or new conversation storage field just to let a hidden run keep progressing and reappear later.
5. Repository evidence shows provider/model behavior has a second concrete dependency beyond removing `cancelInflight(...)`. `client/src/pages/ChatPage.tsx` currently forces provider/model back from `selectedConversation` via sync effects and also disables the Provider control when `selectedConversation` or `messages.length > 0`. That means Task 7 must explicitly update those synchronization and control-lock rules, otherwise the story would still fail even after the implicit cancel calls are removed.
6. External contract evidence supports the hard-fail embedding behavior and the scoped UI reset behavior. The OpenAI API reference states that embeddings input cannot be an empty string, and DeepWiki's repository-grounded summary for `openai/openai-node` aligns with the API contract by noting that invalid inputs are API-level failures rather than client-side silent skips. React's official "Preserving and Resetting State" guidance uses chat-recipient switching as an example of when keyed UI state should reset locally, which supports resetting the visible Chat draft/view without treating that local reset as an instruction to cancel external background work.

## Test Harnesses

No new test harnesses need to be created for Story 0000046. Repository research shows the existing unit, UI, websocket, feature, and e2e harnesses are already capable of covering the behavior this story adds, so future tasks should extend the harnesses below instead of inventing a new test type.

1. Server unit harness for ingest and provider validation:
   - Create no new harness.
   - Reuse the existing `node:test` server unit setup under `server/src/test/unit/`.
   - Primary nearby files are `server/src/test/unit/chunker.test.ts`, the existing OpenAI provider tests, and the existing LM Studio provider tests.
   - This harness is the right place for blank-chunk filtering, chunk renumbering, fresh zero-embeddable failure, and provider-layer blank-input rejection assertions.
2. Client Chat UI websocket harness:
   - Create no new harness.
   - Reuse `client/src/test/setupTests.ts` plus `client/src/test/support/mockChatWs.ts`.
   - `mockChatWs.ts` already provides `setupChatWsHarness()` for mocked `/chat`, `/conversations`, transcript events, sidebar events, and `cancel_ack` flows.
   - This harness is the right place for Chat sidebar selection, New conversation, provider/model change, and explicit Stop assertions.
3. Server websocket / feature harness:
   - Create no new harness.
   - Reuse `server/src/test/features/chat_cancellation.feature`, `server/src/test/steps/chat_cancellation.steps.ts`, `server/src/test/support/wsClient.ts`, and `server/src/test/support/mockLmStudioSdk.ts`.
   - This harness already proves that unsubscribe does not cancel and that explicit `cancel_inflight` does cancel, so Story 0000046 should extend that behavior coverage rather than building a new protocol harness.
4. Existing browser-level coverage:
   - Create no new harness.
   - Reuse the existing Playwright setup in `playwright.config.ts` and the current `e2e/*.spec.ts` files only if a later task decides one user-level smoke test is worth the cost.
   - DeepWiki's Playwright guidance and the existing repo setup both support using ordinary page-level tests for navigation/state checks rather than inventing a custom browser harness. For this story, the lower-level client and server harnesses provide better observability for cancellation behavior than a new e2e harness would.

## Contracts And Storage Shapes

Story 0000046 does not require any brand-new websocket message types, REST payload shapes, database schemas, or vector metadata shapes. Repository research shows the existing contracts already cover the needed outcomes, so implementation should reuse the shapes below and change only the logic that decides when they are used.

1. Chat websocket contracts to reuse unchanged:
   - Reuse the existing client-to-server `cancel_inflight` message in `server/src/ws/types.ts` as the only explicit stop message.
   - Reuse the existing subscription messages (`subscribe_conversation`, `unsubscribe_conversation`, and sidebar subscriptions) with no new fields.
   - Reuse the existing server-to-client transcript events, `cancel_ack`, and `turn_final` event shapes.
   - Story rule: do not add a new websocket message such as `pause`, `background_run`, `switch_conversation`, or any special navigation-cancel payload. The fix belongs in ChatPage behavior, not in a protocol expansion.
2. Chat REST read-model shapes to reuse unchanged:
   - Reuse the existing `GET /conversations/:id/turns` response shape in `server/src/routes/conversations.ts`, including the optional `inflight` snapshot payload.
   - Reuse the existing `useConversationTurns.ts` hydration path on the client when a hidden conversation is revisited.
   - Story rule: do not add a new `hasActiveRun` flag, a new active-run lookup endpoint, or a new response field just to support this story. The existing `inflight` payload already exposes the state the Chat UI needs.
3. Chat persistence shapes to reuse unchanged:
   - Reuse the existing `Conversation` storage shape in `server/src/mongo/conversation.ts`; no new conversation flags or cancellation markers are needed for this story.
   - Reuse the existing `Turn` storage shape in `server/src/mongo/turn.ts`, especially the current `status: 'ok' | 'stopped' | 'failed'` contract for final turn outcomes.
   - Story rule: switching conversations, opening a new conversation, or changing provider/model must not require a new stored conversation field. These are local view/reset actions, not a new persistence model.
4. Ingest failure and provider error shapes to reuse unchanged:
   - Reuse the existing ingest run state contract in `server/src/ingest/types.ts`, especially the current `'error'` state for fresh-ingest blank-input failure cases.
   - Reuse the existing normalized ingest error envelope already emitted by `server/src/ingest/ingestJob.ts`.
   - Reuse the existing `NO_ELIGIBLE_FILES` style fresh-ingest failure contract when blank filtering leaves zero embeddable chunks.
   - Reuse the existing provider error families (`OPENAI_BAD_REQUEST`, `LMSTUDIO_BAD_REQUEST`, and the surrounding normalized error shapes) instead of inventing a new top-level blank-input error payload just for this story.
5. Chunk and vector metadata shapes to reuse unchanged:
   - Reuse the existing `Chunk` and `ChunkMeta` shapes in `server/src/ingest/types.ts`.
   - Reuse the existing per-chunk Chroma metadata fields already written from `server/src/ingest/ingestJob.ts`.
   - Story rule: blank filtering changes which chunks survive and may require `chunkIndex` renumbering before hashing and storage, but it must not add new metadata keys or change the existing metadata field names.
   - Reuse the existing root lock and root summary metadata shapes; their counts should simply reflect the filtered result.
6. Implementation guardrail for this story:
   - If implementation discovers a genuinely unavoidable need for a new contract field, message type, or storage property, that is a scope change and must be documented back into this section before coding proceeds.
   - Based on the current repository and external evidence, no such new contract or shape is needed for Story 0000046.

## Edge Cases and Failure Modes

1. Leading blank piece before the first code boundary:
   - `server/src/ingest/chunker.ts` can currently produce a first piece that is only whitespace when a file starts with blank lines before the first `function`, `class`, or other boundary match.
   - Story rule: filter that blank piece before chunk indexes are assigned so valid later chunks keep deterministic sequential indexes.
2. Whitespace-only slice after token-limit slicing:
   - `sliceToFit()` currently filters only falsy slices, not whitespace-only slices.
   - Story rule: a slice containing only spaces or line breaks must be removed before it can become a chunk or reach a provider.
3. Fresh ingest discovers files but ends with zero embeddable chunks:
   - This is different from the existing `discoverFiles()` zero-files case.
   - Story rule: fresh ingest must fail with the existing `NO_ELIGIBLE_FILES` style contract, and it must not leave partial vectors or a completed root summary behind.
4. Delta re-embed with blank-only outcomes:
   - Story `0000020` semantics still apply.
   - If a re-embed run produces zero new embeddable chunks because changed files became blank, the implementation must still handle no-change and deletions-only outcomes the same way the existing delta flow already does, rather than forcing the fresh-ingest failure behavior onto every re-embed run.
5. Mixed valid and blank files in the same ingest:
   - A repository may contain some valid files and some blank or whitespace-only files.
   - Story rule: valid chunks should still embed successfully; blank files should contribute nothing and must not force the whole run to fail unless the final result for a fresh ingest is zero embeddable chunks overall.
6. Defensive provider guard hit after upstream filtering should have prevented it:
   - This is a failure mode, not a normal control path.
   - Story rule: fail clearly and treat it as an invariant breach; do not silently skip that input and continue as though the ingest succeeded normally.
7. Blank-input failure after earlier successful embeddings:
   - If a provider-side blank-input failure somehow occurs after valid chunks were already written, the run must still end as a clear failure rather than a misleading success.
   - Primary mitigation: blank filtering must happen before batching and embedding so this failure mode becomes defensive-only instead of normal-path behavior.
8. Sidebar selection, New conversation, or provider/model change during an active run:
   - `client/src/pages/ChatPage.tsx` currently routes all three through implicit cancellation paths.
   - Story rule: those actions must become local view/reset changes only; the old run continues server-side, and the newly visible conversation must not inherit `sending`, `stopping`, spinner, or disabled-composer state from the hidden run.
9. Provider/model selection while viewing an existing conversation:
   - `client/src/pages/ChatPage.tsx` currently forces provider/model back from `selectedConversation` and disables the Provider control while a conversation or existing messages are present.
   - Story rule: implementation must update those synchronization and control-lock rules so a user can choose provider/model for the next send without mutating the already-running request, the persisted conversation metadata, or the server contracts that rehydrate hidden runs later.
10. Rapid repeated Chat context switches:
   - A user may switch conversations, open a new conversation, and change provider/model quickly while a previous run is still active.
   - Story rule: the visible Chat view should always reflect the latest selected conversation or new draft only, and any older hidden conversation state should be recovered from normal server history/inflight hydration if the user returns later.
11. Late websocket events from a hidden conversation:
   - `client/src/hooks/useChatStream.ts` already ignores events whose `conversationId` does not match the visible conversation.
   - Story rule: preserve that guard so hidden conversation events cannot render stop banners, assistant text, or completed states into the wrong visible conversation.
12. `cancel_ack` with `result: 'noop'` outside an explicit stop attempt:
   - Existing logic only treats this as meaningful while the client is in stopping state.
   - Story rule: preserve that behavior; navigation/reset actions should not rely on `cancel_ack` to clean themselves up because they should not be sending cancellation in the first place.
13. Non-blank but low-value files:
   - Files that contain comments, imports, or type declarations only are not blank, even if they are low-value for embeddings.
   - Story rule: Story 0000046 is not a chunk-quality or semantic-filtering story. It only removes empty and whitespace-only content, leaving non-blank chunk quality heuristics unchanged.

## Questions

- No Further Questions

## Decisions

1. Question addressed: should the explicit-stop-only rule cover only sidebar selection, or also Chat "New conversation" and provider-change flows? Why this matters: this story is about fixing implicit cancellation at the Chat UI boundary, and leaving closely related Chat reset/navigation actions with different rules would preserve the same user-visible bug in adjacent paths. Decision: apply the explicit-stop-only rule to all three Chat actions in this story: sidebar selection, Chat "New conversation", and provider-change flows. Source and rationale: repository research shows Agents and Flows already treat conversation switching and reset-style actions as local view changes without `cancel_inflight`, while Chat is the outlier; Story 0000038 and Story 0000019 establish that navigation should not cancel background work, and React guidance distinguishes local UI state/reset from explicit cleanup of external effects. This is the best answer because it is the smallest change that aligns Chat with the existing product pattern instead of inventing a new special-case rule just for one Chat control.
2. Question addressed: if blank or whitespace-only content leaves an ingest with zero embeddable chunks, should that be a clear failure or a successful zero-embedding run? Why this matters: the story needs one stable contract for blank-only content, but it should not accidentally redesign existing re-embed semantics from Story 0000020. Decision: for fresh ingest, reuse the existing clear product-owned "no eligible files" failure path when blank filtering leaves zero embeddable chunks; for delta re-embed, keep the existing no-change and deletions-only skipped/completed semantics unchanged. Source and rationale: repository research found `server/src/ingest/ingestJob.ts` already treats fresh zero-eligible ingest as `NO_ELIGIBLE_FILES`, while Story 0000020 deliberately treats no-change and deletions-only re-embed outcomes as terminal no-op success; OpenAI's embeddings API requires non-empty input, and external issue reports show empty embedding requests cause whole indexing runs to fail in practice. This is the best answer because it follows established contracts, keeps the story scoped, and avoids inventing a misleading "successful zero-embedding ingest" result.
3. Question addressed: if the defensive provider-layer blank-input guard is hit after shared filtering should already have prevented it, should the system hard-fail or silently skip and continue? Why this matters: this guard exists to catch an upstream invariant breach, and silently continuing would hide the bug and make counts, ordering, and troubleshooting less trustworthy. Decision: treat the guard as a hard ingest failure with a clear product-owned error; do not silently skip the offending input and continue. Source and rationale: repository research shows the codebase consistently fails fast on invariant violations in flows, commands, chat validation, markdown resolution, and explicit websocket target mismatches rather than silently converting bad state into success; OpenAI's API and external embedding bug reports also confirm that empty-input requests are real failure conditions, not benign warnings. This is the best answer because it preserves observability, matches existing validation patterns, and keeps the defensive guard honest instead of masking a pipeline bug.

# Tasks

### 1. Server - Filter Blank Chunks Before Any Embedding Call

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task isolates the first shared ingest boundary: `chunkText()`. Its job is to make sure blank or whitespace-only pieces never leave the chunker and that surviving chunks keep deterministic sequential indexes. Nothing in this task should change provider behavior or final ingest status handling yet; it should only fix what the chunker returns and prove that with focused unit coverage.

#### Documentation Locations

- Story `0000046` sections: `### Description`, `### Acceptance Criteria`, `## Research Findings`, `## Edge Cases and Failure Modes`
- `server/src/ingest/chunker.ts`
- `server/src/ingest/types.ts`
- `server/src/test/unit/chunker.test.ts`
- OpenAI embeddings API reference: input cannot be an empty string

#### Subtasks

1. [ ] Read `server/src/ingest/chunker.ts`, `server/src/ingest/types.ts`, and `server/src/test/unit/chunker.test.ts` before editing so you understand how pieces, slices, and `chunkIndex` are created today.
2. [ ] Update `server/src/ingest/chunker.ts` so whitespace-only pieces from `splitOnBoundaries()` are removed before they become `Chunk` objects.
3. [ ] Update `server/src/ingest/chunker.ts` so whitespace-only slices from `sliceToFit()` are removed before they become `Chunk` objects.
4. [ ] Ensure `chunkIndex` is reassigned sequentially after all filtering is complete so returned chunks always use `0..n-1` with no gaps.
5. [ ] Extend `server/src/test/unit/chunker.test.ts` with all of the following: empty string input, whitespace-only input, leading blank lines before the first boundary, a whitespace-only slice path, and sequential `chunkIndex` assertions after filtering.
6. [ ] Update Story `0000046` task notes with any new chunking detail discovered while implementing this task so later tasks do not need to rediscover the same boundary rules.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/chunker.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 2. Server - Add Defensive Blank-Input Guards to Embedding Providers

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task adds the defensive provider-layer blank-input checks for OpenAI and LM Studio. The main story fix remains in the shared chunker, but this task ensures that if a blank input ever slips through later, the providers fail with an existing product-owned error shape instead of sending invalid requests downstream. Keep this task focused on provider entry validation only.

#### Documentation Locations

- Story `0000046` sections: `### Acceptance Criteria`, `## Contracts And Storage Shapes`, `## Edge Cases and Failure Modes`
- `server/src/ingest/providers/openaiGuardrails.ts`
- `server/src/ingest/providers/openaiEmbeddingProvider.ts`
- `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`
- `server/src/ingest/providers/openaiErrors.ts`
- Existing server provider tests under `server/src/test/unit/`
- OpenAI embeddings API reference and the `openai/openai-node` repository error-handling guidance

#### Subtasks

1. [ ] Read `server/src/ingest/providers/openaiGuardrails.ts`, `server/src/ingest/providers/openaiEmbeddingProvider.ts`, `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`, and the nearby provider tests before editing.
2. [ ] Update the OpenAI guardrail path so any input whose trimmed text length is zero fails before `client.embeddings.create(...)` is called, using the existing OpenAI error family rather than inventing a new top-level error shape.
3. [ ] Update the LM Studio embedding path so any input whose trimmed text length is zero fails before `model.embed(...)` is called, using the existing LM Studio normalized error family rather than inventing a new top-level error shape.
4. [ ] Extend the most relevant existing provider unit tests so OpenAI and LM Studio both reject blank defensive inputs with the story’s existing product-owned error semantics.
5. [ ] Update Story `0000046` task notes with the exact provider entry points and error families used so later tasks can reuse the same contract wording.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --test-name "blank input|OpenAI|LM Studio|guardrail"`
6. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 3. Server - Fail Fresh Ingest Cleanly When Filtering Leaves Zero Embeddable Chunks

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task handles the second server-side ingest boundary: what happens after chunk filtering when the run discovered files but ended with zero embeddable chunks. It must reuse the existing `NO_ELIGIBLE_FILES` style failure path for fresh ingest, preserve Story `0000020` delta re-embed semantics, and prevent a failed blank-only fresh ingest from looking partially successful in persisted ingest data.

#### Documentation Locations

- Story `0000046` sections: `### Description`, `### Acceptance Criteria`, `## Research Findings`, `## Contracts And Storage Shapes`, `## Edge Cases and Failure Modes`
- `server/src/ingest/ingestJob.ts`
- `server/src/ingest/deltaPlan.ts`
- `server/src/test/unit/ingest-start.test.ts`
- `server/src/test/unit/ingest-reembed.test.ts`
- Story `0000020-ingest-delta-reembed-and-ingest-page-ux.md`

#### Subtasks

1. [ ] Read `server/src/ingest/ingestJob.ts`, `server/src/ingest/deltaPlan.ts`, `server/src/test/unit/ingest-start.test.ts`, and `server/src/test/unit/ingest-reembed.test.ts` before editing so you understand the current fresh-ingest and delta re-embed completion paths.
2. [ ] Update `server/src/ingest/ingestJob.ts` so a fresh ingest that discovered files but ended with zero embeddable chunks fails with the existing `NO_ELIGIBLE_FILES` style error contract.
3. [ ] Ensure that fresh-ingest zero-embeddable failure happens before a completed root summary is written, and that the failed run does not leave misleading completed-state persistence behind.
4. [ ] Preserve Story `0000020` behavior for re-embed no-change and deletions-only flows; do not force the fresh-ingest failure rule onto every re-embed run.
5. [ ] Extend the most relevant server tests so fresh blank-only ingest failure and delta re-embed blank-only/deletions-only behavior are both covered.
6. [ ] Update Story `0000046` task notes with the exact fresh-ingest versus re-embed behavior that was implemented so later documentation work can quote one final rule.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --test-name "NO_ELIGIBLE_FILES|reembed|delta|blank"`
6. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 4. Server - Lock Down The Websocket Cancellation Contract Before Chat UI Changes

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task makes the existing server-side cancellation contract explicit before any Chat UI refactor depends on it. The story is not meant to redesign websocket protocol behavior, so this task should prove and, if needed, tighten the current rule that `cancel_inflight` is the only real stop message and `unsubscribe_conversation` remains subscription-only. If any server-side message wording or feature-step assertions need to change to keep that contract clear and testable, do that here before the frontend tasks rely on it.

#### Documentation Locations

- Story `0000046` sections: `### Acceptance Criteria`, `## Decisions`, `## Contracts And Storage Shapes`, `## Edge Cases and Failure Modes`
- `server/src/ws/types.ts`
- `server/src/ws/server.ts`
- `server/src/ws/registry.ts`
- `server/src/test/features/chat_cancellation.feature`
- `server/src/test/steps/chat_cancellation.steps.ts`

#### Subtasks

1. [ ] Read `server/src/ws/types.ts`, `server/src/ws/server.ts`, `server/src/ws/registry.ts`, `server/src/test/features/chat_cancellation.feature`, and `server/src/test/steps/chat_cancellation.steps.ts` before editing so you understand the current subscription and cancellation message flow.
2. [ ] Update the server-side chat cancellation feature coverage so it explicitly proves `unsubscribe_conversation` does not cancel a running chat and that `cancel_inflight` remains the only authoritative stop message.
3. [ ] If any step definitions or server-side message wording need to change so the contract is stable and easy to assert, update them here without introducing any new websocket message types or changing the meaning of `unsubscribe_conversation`.
4. [ ] Keep this task server-focused: do not change Chat page interaction code here. The output of this task should be a locked-down server contract and regression coverage that the later client tasks can rely on.
5. [ ] Update Story `0000046` task notes with the exact server-side cancellation contract confirmed or clarified by this task so the later Chat tasks can quote one final rule.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_cancellation.feature`
6. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 5. Client - Conversation Sidebar Selection Becomes Pure Navigation

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task handles only the Chat sidebar selection path. The goal is to make selecting another conversation behave like navigation: no implicit `cancel_inflight`, no stop state leaking into the newly selected view, and no change to the explicit Stop button contract. Keep this task focused on sidebar selection only, not New conversation or provider/model changes.

#### Documentation Locations

- Story `0000046` sections: `### Description`, `### Acceptance Criteria`, `## Edge Cases and Failure Modes`
- `client/src/pages/ChatPage.tsx`
- `client/src/hooks/useChatStream.ts`
- `client/src/hooks/useChatWs.ts`
- `client/src/test/chatSidebar.test.tsx`
- `client/src/test/agentsPage.conversationSelection.test.tsx`
- `server/src/ws/types.ts`

#### Subtasks

1. [ ] Read `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`, `client/src/test/chatSidebar.test.tsx`, and `client/src/test/agentsPage.conversationSelection.test.tsx` before editing so you understand the current selection and websocket patterns.
2. [ ] Update the Chat sidebar selection path in `client/src/pages/ChatPage.tsx` so choosing another conversation no longer sends `cancelInflight(...)`.
3. [ ] Preserve the existing local view reset/rehydration behavior so the newly selected conversation shows its own transcript and does not inherit sending or stopping UI state from the hidden conversation.
4. [ ] Extend or add a focused Chat sidebar test proving that selection no longer sends `cancel_inflight` and that the newly visible conversation shows only its own state.
5. [ ] Update Story `0000046` task notes with the exact Chat sidebar call site changed and any local UI-state reset rule clarified during implementation.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:client -- --file client/src/test/chatSidebar.test.tsx`
6. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 6. Client - New Conversation Becomes a Local Draft Reset, Not a Stop Action

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task isolates the `New conversation` control. The required output is a clean new draft view with normal composer/send readiness while the old conversation keeps running in the background unless the user explicitly presses Stop. This task should not change provider/model switching; it is only about the New conversation control.

#### Documentation Locations

- Story `0000046` sections: `### Description`, `### Acceptance Criteria`, `## Edge Cases and Failure Modes`
- `client/src/pages/ChatPage.tsx`
- `client/src/hooks/useChatStream.ts`
- `client/src/test/chatPage.newConversation.test.tsx`
- `client/src/test/chatPage.inflightNavigate.test.tsx`
- `client/src/test/chatPage.stop.test.tsx`

#### Subtasks

1. [ ] Read `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, `client/src/test/chatPage.newConversation.test.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, and `client/src/test/chatPage.stop.test.tsx` before editing.
2. [ ] Update the `handleNewConversation(...)` path so it no longer sends `cancelInflight(...)` when another conversation is active.
3. [ ] Preserve the local reset behavior so the new conversation opens with an empty transcript placeholder, a cleared input, and normal composer/send readiness for the next user message.
4. [ ] Extend `client/src/test/chatPage.newConversation.test.tsx` so it now proves the opposite of the old contract: no `cancel_inflight` is sent, the old run can continue server-side, and the new draft view is locally interactive.
5. [ ] Keep the explicit Stop button behavior unchanged by updating or cross-checking `client/src/test/chatPage.stop.test.tsx` only if the New conversation refactor changes shared UI code.
6. [ ] Update Story `0000046` task notes with the exact local draft reset rules implemented for `New conversation`.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.newConversation.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.stop.test.tsx`
7. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 7. Client - Provider and Model Changes Apply Only to the Next Send

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task isolates provider/model switching during an active run. The selected provider/model should change only for the next message the user sends, while the already-running request continues with the provider/model it started with. Keep this task focused on the provider/model-change path only.

#### Documentation Locations

- Story `0000046` sections: `### Description`, `### Acceptance Criteria`, `## Contracts And Storage Shapes`, `## Edge Cases and Failure Modes`
- `client/src/pages/ChatPage.tsx`
- `client/src/hooks/useChatModel.ts`
- `client/src/hooks/useConversationTurns.ts`
- `server/src/routes/conversations.ts`
- `server/src/mongo/conversation.ts`
- `client/src/test/chatPage.provider.conversationSelection.test.tsx`
- `client/src/test/chatPage.models.test.tsx`
- `client/src/test/chatPage.stop.test.tsx`

#### Subtasks

1. [ ] Read `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatModel.ts`, `client/src/hooks/useConversationTurns.ts`, `server/src/routes/conversations.ts`, `client/src/test/chatPage.provider.conversationSelection.test.tsx`, and `client/src/test/chatPage.models.test.tsx` before editing so you understand the current provider/model selection flow, the selected-conversation sync effects, and the existing hidden-run hydration path.
2. [ ] Update the provider/model change path so an active run is not cancelled when the user changes provider or model.
3. [ ] Update the current ChatPage synchronization rules so provider/model selections are not immediately overwritten by `selectedConversation` effects when the user is intentionally choosing the next-send values.
4. [ ] Update the current Provider control locking rules so the story’s next-send provider/model behavior is actually reachable in the UI, without adding a new server endpoint, a new response field, or a new conversation storage property.
5. [ ] Ensure the newly selected provider/model affects only the next send and does not mutate the provider/model already associated with the in-flight request, the persisted conversation metadata, or the existing `/conversations/:id/turns` hydration contract used when the user revisits a hidden run.
6. [ ] Extend the most relevant Chat provider/model tests so they prove no `cancel_inflight` is sent during an active run, the next send uses the new selection, and revisiting the older hidden conversation still shows its own provider/model state rather than the newly chosen next-send values.
7. [ ] Update Story `0000046` task notes with the exact provider/model persistence and synchronization rule implemented for in-flight, revisited, and next-send behavior.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.provider.conversationSelection.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.models.test.tsx`
7. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 8. Client - Preserve Visible Conversation Isolation While Hidden Runs Continue

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task locks down the failure mode that appears after Tasks 5-7 remove implicit cancellation: hidden conversations can still finish in the background, but their late websocket events must not leak banners, assistant content, or stopping state into whichever conversation is currently visible. This task should focus on state-isolation and regression coverage only.

#### Documentation Locations

- Story `0000046` sections: `### Acceptance Criteria`, `## Research Findings`, `## Edge Cases and Failure Modes`
- `client/src/hooks/useChatStream.ts`
- `client/src/hooks/useConversationTurns.ts`
- `client/src/pages/ChatPage.tsx`
- `server/src/routes/conversations.ts`
- `client/src/test/useChatStream.inflightMismatch.test.tsx`
- `client/src/test/chatPage.inflightNavigate.test.tsx`
- `server/src/test/features/chat_cancellation.feature`
- `server/src/test/steps/chat_cancellation.steps.ts`

#### Subtasks

1. [ ] Read `client/src/hooks/useChatStream.ts`, `client/src/hooks/useConversationTurns.ts`, `client/src/pages/ChatPage.tsx`, `server/src/routes/conversations.ts`, `client/src/test/useChatStream.inflightMismatch.test.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, and the existing chat cancellation feature files before editing.
2. [ ] Adjust local Chat state handling only if needed so the visible conversation or new draft clears inherited sending/stopping indicators when another conversation is still running in the background.
3. [ ] Reuse the existing `/conversations/:id/turns` inflight snapshot and `useConversationTurns.ts` hydration path when proving that a hidden run can be revisited later; do not add a new active-run endpoint or a new response flag for this story.
4. [ ] Extend client regression coverage to prove that late websocket events from a hidden conversation do not render stop banners, stopped state, or assistant content in the visible conversation, and that revisiting the hidden conversation rehydrates its own in-flight state through the existing turns snapshot path.
5. [ ] Extend server-side feature coverage only if needed to prove that navigation/reset actions leave the server-side run active until an explicit `cancel_inflight` arrives.
6. [ ] Update Story `0000046` task notes with any additional conversation-isolation rule, hydration rule, or websocket mismatch case discovered while implementing this task.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:client -- --file client/src/test/useChatStream.inflightMismatch.test.tsx`
6. [ ] `npm run test:summary:client -- --file client/src/test/chatPage.inflightNavigate.test.tsx`
7. [ ] `npm run test:summary:server:cucumber -- --feature server/src/test/features/chat_cancellation.feature`
8. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 9. Final Task - Validate Story Completion and Documentation

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This final task proves the story end to end against the acceptance criteria. It must run the full wrapper-based builds and tests, confirm the product still behaves correctly in docker, update shared documentation, and record a PR-ready summary. It is also responsible for checking that the story notes still explain how Story `0000046` relates to Story `0000043` and Story `0000020`.

#### Documentation Locations

- `README.md`
- `design.md`
- `projectStructure.md`
- Story `0000046`
- Story `0000020-ingest-delta-reembed-and-ingest-page-ux.md`
- Story `0000043-stop-any-point-cancellation.md`
- Docker/Compose documentation
- Playwright documentation
- Jest documentation
- Cucumber guides

#### Subtasks

1. [ ] Review every acceptance criterion in Story `0000046` and confirm each earlier task changed the right files and added the right regression coverage.
2. [ ] Ensure `README.md` documents any user-visible behavior change or operator-facing command change introduced by this story.
3. [ ] Ensure `design.md` describes the final shared-boundary rules for blank embeddable text and “navigation is not cancellation,” including any diagram or flow text that would otherwise be misleading.
4. [ ] Ensure `projectStructure.md` lists any added, removed, or repurposed files touched by this story.
5. [ ] Create a pull-request-ready summary covering the ingest boundary fix, the defensive provider guard, the Chat navigation/reset behavior change, the reused contracts, and the added regression coverage.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts and resolve any remaining issues.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit`
6. [ ] `npm run test:summary:client`
7. [ ] `npm run test:summary:server:cucumber`
8. [ ] `npm run test:summary:e2e`
9. [ ] Use the Playwright MCP/browser tooling to manually verify the ingest blank-input failure path and the Chat navigation/no-implicit-cancel behavior, saving screenshots under `test-results/screenshots/` using the story index and task number in each filename.
10. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
