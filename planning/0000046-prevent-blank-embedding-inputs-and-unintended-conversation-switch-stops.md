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

- Verified package-version context from the repository manifests:
  - `client/package.json` shows `react` `^19.2.0`, `react-dom` `^19.2.0`, `react-router-dom` `7.9.6`, and `@mui/material` `^6.4.1`.
  - `server/package.json` shows `openai` `6.24.0`, `@lmstudio/sdk` `1.5.0`, `ws` `8.18.3`, `mongoose` `9.0.1`, and `@cucumber/cucumber` `^11.0.1`.
  - The MUI MCP server does not expose `6.4.1` directly; the nearest available Material UI docs are `6.4.12`, which still match the currently used `TextField select`, `SelectProps`, and `slotProps.select` APIs in `client/src/pages/ChatPage.tsx`.

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

## External Library Verification

These notes capture the external-library assumptions that were checked against current docs and then compared with the repo's actual usage. If a later implementer is tempted to change direction, start from these verified boundaries first.

1. React `19.2` guidance still supports the current event-handler-first plan. The official React docs distinguish event handlers from Effects and say Effects are for synchronizing with external systems, while interaction-driven updates such as reset, navigation, and local state changes belong in event handlers. They also confirm that state is preserved or reset based on component position in the UI tree. For Story `0000046`, that means the Chat fixes should stay inside existing handlers such as `handleSelectConversation(...)`, `handleNewConversation(...)`, `handleProviderChange(...)`, and the model selector path, while the existing effect-based websocket and snapshot synchronization remains in place.
2. MUI Material `TextField`/`Select` docs match the control pattern already used in `client/src/pages/ChatPage.tsx`. The official docs say the `select` prop makes `TextField` use `Select` internally, and the `TextField` API still supports `SelectProps` and `slotProps.select`. They also note that `TextField` with `id` and `label` already creates the proper accessible select labeling. For Story `0000046`, that means the plan should keep the existing `TextField select` controls and update only the state/disabled logic, not swap them out for a different control abstraction.
3. OpenAI's current embeddings docs and the `openai/openai-node` SDK docs both support the provider-guard task. The official API reference says embedding input cannot be an empty string, and DeepWiki confirms the current Node SDK surface is `client.embeddings.create({ model, input })` with validation expected in application code before the request is made. For Story `0000046`, that means the plan is correct to keep the main fix in the shared chunking boundary while also retaining a provider-entry defensive guard before `client.embeddings.create(...)`, reusing the existing OpenAI error family instead of inventing a new provider wrapper.
4. LM Studio's current TypeScript docs match the provider path already in the repo. The docs show `const { embedding } = await model.embed(\"Hello, world!\")`, which matches the current `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` call shape. For Story `0000046`, that means the plan should keep any defensive blank-input rejection at the existing `embedText(...)` entry path before `model.embed(...)`, while reusing the existing LM Studio retry and error-normalization structure.
5. The `ws` documentation matches the server's current upgrade model. The official README documents `new WebSocketServer({ noServer: true })` plus manual `upgrade` handling on the HTTP server, which is the same pattern already used in `server/src/ws/server.ts`. For Story `0000046`, that means the websocket tasks should stay focused on current subscription/cancellation semantics and regression coverage rather than redesigning the transport or adding new protocol messages.

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

1. Repository evidence shows the ingest story needs one extra explicit boundary after chunking, not just before file discovery. `server/src/ingest/ingestJob.ts` already fails fresh ingest when `discoverFiles()` returns zero files, but `server/src/ingest/chunker.ts` can currently emit blank chunks and the ingest loop embeds every returned chunk directly. Direct inspection of the current post-processing path also shows that when `counts.embedded === 0` after files were discovered, the job currently falls through the `resultState` / `roots.add(...)` success path and writes a root summary with `state: 'skipped'`. That means blank filtering can create a new case where files were discovered successfully but the run still has zero embeddable chunks, and the implementation must stop that case before the current success-like persistence path runs.
2. Repository evidence shows the server-side websocket contract is already aligned with the desired stop behavior. `server/src/ws/server.ts` handles `unsubscribe_conversation` as subscription-only and `cancel_inflight` as the explicit stop path, while `server/src/test/features/chat_cancellation.feature` already proves unsubscribe does not cancel. This means Story 0000046 should stay scoped to Chat client handlers, UI state reset behavior, and regression coverage rather than redesigning websocket protocol semantics.
3. Repository evidence shows the client already has the late-event protection this story needs. `client/src/hooks/useChatStream.ts` resets local inflight indicators when the active conversation changes and ignores websocket events whose `conversationId` does not match the currently visible conversation. That means the story does not need a new hidden-conversation state system; it needs ChatPage to stop sending `cancelInflight(...)` during navigation/reset actions and then rely on the existing conversation-mismatch guard.
4. Repository evidence shows the hidden-run rehydration interface already exists and should be reused instead of expanded. `server/src/routes/conversations.ts` already returns an optional `inflight` snapshot from `GET /conversations/:id/turns`, and `client/src/hooks/useConversationTurns.ts` already hydrates that snapshot back into client state when a conversation is revisited. That means Story 0000046 does not need a new "active run" endpoint, extra response flag, or new conversation storage field just to let a hidden run keep progressing and reappear later.
5. Repository evidence shows provider/model behavior has a second concrete dependency beyond removing `cancelInflight(...)`. `client/src/pages/ChatPage.tsx` currently forces provider/model back from `selectedConversation` via sync effects and also disables the Provider control when `selectedConversation` or `messages.length > 0`. That means the split provider/model tasks must explicitly update those synchronization and control-lock rules, otherwise the story would still fail even after the implicit cancel calls are removed.
6. External contract evidence supports the hard-fail embedding behavior and the scoped UI reset behavior. The OpenAI API reference states that embeddings input cannot be an empty string, and DeepWiki's repository-grounded summary for `openai/openai-node` aligns with the API contract by noting that invalid inputs are API-level failures rather than client-side silent skips. React's official "Preserving and Resetting State" guidance uses chat-recipient switching as an example of when keyed UI state should reset locally, which supports resetting the visible Chat draft/view without treating that local reset as an instruction to cancel external background work.
7. Current library-version evidence supports keeping the Chat UI change small and in place. Repository package manifests show the client is already on React `19.2.0`, React Router `7.9.6`, and MUI `6.4.1`, and direct inspection of `client/src/pages/ChatPage.tsx` shows the Provider and Model controls are existing MUI `TextField` components using `select`, `SelectProps`, and `slotProps.select`. MUI's current Material UI documentation for the matching major version confirms those APIs already support the disabled/display behavior this page uses today, so Story `0000046` should adjust only the state and locking logic around those controls rather than replacing them with a new select implementation.

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
2. Question addressed: if blank or whitespace-only content leaves an ingest with zero embeddable chunks, should that be a clear failure or a successful zero-embedding run? Why this matters: the story needs one stable contract for blank-only content, but it should not accidentally redesign existing re-embed semantics from Story 0000020. Decision: for fresh ingest, reuse the existing clear product-owned "no eligible files" failure path when blank filtering leaves zero embeddable chunks; for delta re-embed, keep the existing no-change and deletions-only skipped/completed semantics unchanged. Source and rationale: repository research found `server/src/ingest/ingestJob.ts` already uses `state: 'error'` plus `error.error = 'NO_ELIGIBLE_FILES'` when `discoverFiles()` returns zero files, but the later post-chunking zero-embeddable path currently falls through to `resultState` / `roots.add(...)` and writes a misleading `state: 'skipped'` root summary. Story 0000046 therefore extends the existing zero-files failure contract to that later boundary instead of inventing a new zero-embedding success state. This is the best answer because it follows established contracts, keeps the story scoped, and avoids inventing a misleading "successful zero-embedding ingest" result.
3. Question addressed: if the defensive provider-layer blank-input guard is hit after shared filtering should already have prevented it, should the system hard-fail or silently skip and continue? Why this matters: this guard exists to catch an upstream invariant breach, and silently continuing would hide the bug and make counts, ordering, and troubleshooting less trustworthy. Decision: treat the guard as a hard ingest failure with a clear product-owned error; do not silently skip the offending input and continue. Source and rationale: repository research shows the codebase consistently fails fast on invariant violations in flows, commands, chat validation, markdown resolution, and explicit websocket target mismatches rather than silently converting bad state into success; OpenAI's API and external embedding bug reports also confirm that empty-input requests are real failure conditions, not benign warnings. This is the best answer because it preserves observability, matches existing validation patterns, and keeps the defensive guard honest instead of masking a pipeline bug.

# Tasks

### 1. Server - Filter Blank Chunks Before Any Embedding Call

- Task Status: `__done__`
- Git Commits: `2a571f76, 4f5d0c9a`

#### Overview

This task isolates the first shared ingest boundary: `chunkText()`. Its job is to make sure blank or whitespace-only pieces never leave the chunker and that surviving chunks keep deterministic sequential indexes. Nothing in this task should change provider behavior or final ingest status handling yet; it should only fix what the existing chunker returns and prove that with focused unit coverage. Update the current chunker implementation in place instead of introducing a second chunk-processing path.

#### Documentation Locations

- TypeScript handbook: `https://www.typescriptlang.org/docs/handbook/2/narrowing.html` — use this for safe typed filtering/narrowing when trimming and removing blank chunk candidates in place.
- Node.js `node:test` API: `https://nodejs.org/api/test.html` — use this for the correct structure of focused unit tests and subtests in the existing server harness.
- OpenAI embeddings API reference: `https://platform.openai.com/docs/api-reference/embeddings/create` — use this because it is the product contract proving empty embedding input is invalid, which is why blank chunks must never leave `chunkText()`.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read `server/src/ingest/chunker.ts`, `server/src/ingest/types.ts`, and `server/src/test/unit/chunker.test.ts`, then reread Story `0000046` `## Research Findings` item 1 and `## Edge Cases and Failure Modes` items 1-3 so you understand the current `chunkText()`, `splitOnBoundaries()`, `sliceToFit()`, and `chunkIndex` behavior before editing. Use these docs while reading: TypeScript narrowing `https://www.typescriptlang.org/docs/handbook/2/narrowing.html`, Node `node:test` `https://nodejs.org/api/test.html`, and the OpenAI embeddings contract `https://platform.openai.com/docs/api-reference/embeddings/create`.
2. [x] Update `chunkText()` inside `server/src/ingest/chunker.ts` so one shared blank-chunk filter removes whitespace-only candidates before they are returned, following Story `0000046` `### Acceptance Criteria` lines about never sending blank text to providers. The exact anchors to inspect first are `splitOnBoundaries(...)`, `sliceToFit(...)`, and the final `return chunks;` path. Prefer one final in-place filter that covers both `splitOnBoundaries()` output and `sliceToFit()` output, instead of adding separate filtering branches for each source path. Use the OpenAI embeddings API contract `https://platform.openai.com/docs/api-reference/embeddings/create` as the reason this shared boundary must reject blank text before any provider call happens.
3. [x] Ensure the final `Chunk.chunkIndex` values produced by `server/src/ingest/chunker.ts` are reassigned sequentially after all filtering is complete so returned chunks always use `0..n-1` with no gaps, as required by Story `0000046` `### Acceptance Criteria` and the chunk-determinism notes in `## Research Findings`. Prefer the smallest in-place change that keeps the current chunk shape; do not introduce a second chunk metadata pass unless the existing flow truly cannot express the renumbering safely.
4. [x] Add a `node:test` unit test in `server/src/test/unit/chunker.test.ts` that calls `chunkText()` with an empty string and asserts no chunks are returned. Purpose: prove the happy-path blank filter handles a completely empty file without producing any embeddable output.
5. [x] Add a `node:test` unit test in `server/src/test/unit/chunker.test.ts` that calls `chunkText()` with whitespace-only content and asserts no chunks are returned. Purpose: prove whitespace-only files are treated the same as empty files before any provider call can happen.
6. [x] Add a `node:test` unit test in `server/src/test/unit/chunker.test.ts` that covers leading blank lines before the first boundary and asserts the first returned chunk is real content, not an empty placeholder. Purpose: lock down the boundary-splitting corner case already called out in Story `0000046` `## Research Findings`.
7. [x] Add a `node:test` unit test in `server/src/test/unit/chunker.test.ts` that drives the fallback slice path with content that would otherwise create a whitespace-only slice and asserts that slice is removed. Purpose: prove the shared final blank filter covers both `splitOnBoundaries(...)` and `sliceToFit(...)`.
8. [x] Add a `node:test` unit test in `server/src/test/unit/chunker.test.ts` that asserts `chunkIndex` values are sequential `0..n-1` after blank chunks are removed. Purpose: prove filtering does not leave index gaps that would make persisted chunk metadata misleading.
9. [x] Add a `node:test` unit test in `server/src/test/unit/chunker.test.ts` that passes a normal non-blank multi-chunk input and asserts the returned chunk text ordering is preserved after the blank filter runs. Purpose: prove the story does not regress meaningful content ordering for valid files while removing blank chunks.
10. [x] Update Story `0000046` `## Research Findings` or task implementation notes with any new chunking detail discovered while implementing this task so later tasks do not need to rediscover the same boundary rules.
11. [x] Add one product-owned verification log line around the shared blank-filter boundary, using the exact prefix `DEV-0000046:T1:blank-chunks-filtered`, in the smallest existing server-side logging path that can record the run id, file path or relPath, removed blank-chunk count, and surviving chunk count without duplicating logging layers. Purpose: give the manual Playwright validation step one concrete server event to confirm when blank chunks are removed as expected.
12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server ingest code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server chunking behavior and nearby `node:test` coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run compose:build:summary` - Use because this task is manually testable through the app UI. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`: trigger an ingest that includes blank-leading or whitespace-only content, confirm the browser debug console has no logged errors, and confirm the server logs contain `DEV-0000046:T1:blank-chunks-filtered` with `removedBlankChunkCount > 0` and a non-negative surviving chunk count when blank chunks are filtered.
6. [x] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
- Subtask 1: Re-read `chunker.ts`, `types.ts`, `chunker.test.ts`, and the story research/edge-case sections; confirmed the current bug is a shared post-split/post-slice blank-output gap and that Task 1 must stay scoped to chunk output plus tests/logging only.
- Subtasks 2-3: Reworked `chunkText()` to collect candidate chunks first, apply one final whitespace-only filter across both boundary and slice outputs, and renumber surviving `chunkIndex` values sequentially without changing non-blank text content.
- Subtasks 4-9: Added unit coverage for empty input, whitespace-only input, leading blank lines, slice-path blank removal, sequential index renumbering, and preserved non-blank chunk ordering after filtering.
- Subtasks 10-11: Logged `DEV-0000046:T1:blank-chunks-filtered` from the shared chunking path with `runId`, `relPath`, removed blank count, and surviving chunk count; confirmed a trailing-whitespace remainder can reach the slice path, so one final post-build filter is the safe shared boundary.
- Subtask 12: `npm run lint --workspaces` completed with existing repo-wide import-order warnings outside this task; `npm run format:check --workspaces` initially failed on `server/src/test/unit/chunker.test.ts`, then passed after formatting that file with the repo formatter.
- Testing step 1: `npm run build:summary:server` passed cleanly with `warning_count: 0`; wrapper log path `logs/test-summaries/build-server-latest.log`.
- Testing step 2: `npm run test:summary:server:unit` passed cleanly with `tests run: 1151`, `passed: 1151`, `failed: 0`; wrapper log path `test-results/server-unit-tests-2026-03-13T10-41-06-763Z.log`.
- Testing step 3: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`; wrapper log path `logs/test-summaries/compose-build-latest.log`.
- Testing step 4: `npm run compose:up` started the compose stack successfully; client and server containers reached started/healthy state.
- Testing step 5: Manual Playwright-MCP validation at `http://host.docker.internal:5001/ingest` passed against non-git fixture path `/Users/danielstapleton/Documents/dev/task1-manual-nongit`; the UI completed with `Files: 2`, `Chunks: 1`, `Embedded: 1`, browser console error output stayed empty, and server file logs recorded `DEV-0000046:T1:blank-chunks-filtered` for `blank-leading.ts` (`removedBlankChunkCount: 1`, `survivingChunkCount: 1`) and `whitespace-only.ts` (`removedBlankChunkCount: 1`, `survivingChunkCount: 0`) in `/app/logs/server.1.log`.
- Testing step 6: `npm run compose:down` completed cleanly and removed the compose containers plus `codeinfo2_internal` network.

---

### 2. Server - Add Defensive Blank-Input Guards to the OpenAI Embedding Path

- Task Status: `__done__`
- Git Commits: `a2bdcdac, a3d64ea6, dbea6ad7, 28bcc19d, 6cd93792`

#### Overview

This task adds the defensive provider-layer blank-input check for the OpenAI embedding path only. The main story fix remains in the shared chunker, but this task ensures that if a blank input ever slips through later, the OpenAI path fails with an existing product-owned error shape instead of sending an invalid request downstream. Keep this task focused on OpenAI provider entry validation only.

#### Documentation Locations

- OpenAI embeddings API reference: `https://platform.openai.com/docs/api-reference/embeddings/create` — use this for the request contract and bad-input expectations that the guard must enforce before any SDK call.
- DeepWiki MCP repository `openai/openai-node`, pages `4.3 Embeddings` and `5.2 Error Handling` — use these because they document the exact Node SDK surfaces this repo uses for `client.embeddings.create(...)` and the `APIError` family the task must continue to normalize instead of inventing a parallel error path.
- Node.js `node:test` API: `https://nodejs.org/api/test.html` — use this for extending the existing focused OpenAI provider tests without changing harness style.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read `server/src/ingest/providers/openaiGuardrails.ts`, `server/src/ingest/providers/openaiEmbeddingProvider.ts`, `server/src/ingest/providers/openaiErrors.ts`, `server/src/ingest/providers/ingestFailureClassifier.ts`, `server/src/test/unit/openai-provider-guardrails.test.ts`, and `server/src/test/unit/openai-provider.test.ts`, then reread Story `0000046` `## Contracts And Storage Shapes` item 4 and `## Decisions` item 3 before editing. Use these docs while reading: OpenAI embeddings API `https://platform.openai.com/docs/api-reference/embeddings/create`, DeepWiki MCP repository `openai/openai-node` pages `4.3 Embeddings` and `5.2 Error Handling`, and Node `node:test` `https://nodejs.org/api/test.html`.
2. [x] Update the existing OpenAI guardrail path in `server/src/ingest/providers/openaiGuardrails.ts` or the first OpenAI provider entry in `server/src/ingest/providers/openaiEmbeddingProvider.ts` so any input whose trimmed text length is zero fails before `client.embeddings.create(...)` is called, matching Story `0000046` `### Acceptance Criteria` and reusing the existing `OpenAiEmbeddingError` family from `server/src/ingest/providers/openaiErrors.ts` rather than inventing a new validation layer or a new top-level error shape. The exact SDK call shape already used in the repo is `client.embeddings.create({ model, input: inputs })` inside `createOpenAiEmbeddingProvider(...)`. Prefer extending `validateOpenAiEmbeddingGuardrails(...)` first if that keeps the change small, because that helper is already the shared OpenAI validation boundary used by the current provider path and the official API docs say embedding input cannot be an empty string.
3. [x] Add a `node:test` unit test in `server/src/test/unit/openai-provider-guardrails.test.ts` or `server/src/test/unit/openai-provider.test.ts` that passes `""` into the OpenAI embedding path and asserts the existing product-owned blank-input error is returned. Purpose: prove the guard rejects the simplest invalid request before any SDK call.
4. [x] Add a `node:test` unit test in `server/src/test/unit/openai-provider-guardrails.test.ts` or `server/src/test/unit/openai-provider.test.ts` that passes whitespace-only input into the OpenAI embedding path and asserts the same existing blank-input error is returned. Purpose: prove the guard trims input rather than only checking raw string length.
5. [x] Add a `node:test` unit test in `server/src/test/unit/openai-provider-guardrails.test.ts` or `server/src/test/unit/openai-provider.test.ts` that passes a mixed batch containing valid text plus one blank entry and asserts the whole batch is rejected. Purpose: prove one bad element still protects the provider boundary for multi-input requests.
6. [x] Add a `node:test` unit test in `server/src/test/unit/openai-provider.test.ts` that spies on `client.embeddings.create(...)` and asserts it is never called when the guard rejects a blank batch. Purpose: prove the validation stays upstream of the network boundary.
7. [x] Update Story `0000046` task notes with the exact OpenAI provider entry points, file paths, and error family used so the later LM Studio and ingest tasks can reuse the same contract wording without having to rediscover it.
8. [x] Add one product-owned verification log line around the OpenAI defensive guard path, using the exact prefix `DEV-0000046:T2:openai-blank-input-guard-hit`, in the existing OpenAI provider/guardrail logging boundary so it records provider, model, batch size, and the fact that the SDK call was blocked before `client.embeddings.create(...)`. Purpose: give the targeted server-wrapper proof and final backend/docs-only regression notes one concrete server event to confirm when the OpenAI guard is hit.
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server provider validation code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit -- --file server/src/test/unit/openai-provider.test.ts --file server/src/test/unit/openai-provider-guardrails.test.ts` - Use because this task only changes the OpenAI provider path and its nearby unit coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands that keep the run scoped to these same OpenAI files. The unrelated full-suite wrapper baseline is restored in Task 3 before later tasks depend on it again.
3. [x] Review the targeted wrapper proof from testing step 2 and confirm the Task 2-specific server evidence exists in the asserted path: `DEV-0000046:T2:openai-blank-input-guard-hit` appears with `provider: openai`, the expected model, and `blockedBeforeSdk: true`. Use because this defensive provider guard is intentionally unreachable from honest browser flows after Task 1 chunk filtering and the repo’s upstream request validation. If this evidence is missing from the targeted proof, keep Task 2 open and fix the guard/test boundary before moving on.

#### Implementation notes

- Read the current OpenAI provider/guardrail files, tests, story contract item 4, and decision item 3; confirmed Task 2 should extend the existing OpenAI guardrail boundary and reuse `OpenAiEmbeddingError` without pulling Task 5 ingest-failure work forward.
- Extended `validateOpenAiEmbeddingGuardrails(...)` in [server/src/ingest/providers/openaiGuardrails.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/providers/openaiGuardrails.ts) to hard-fail trimmed blank inputs with `OpenAiEmbeddingError('OPENAI_BAD_REQUEST', ...)`, keeping the check ahead of `client.embeddings.create(...)`.
- Added the `DEV-0000046:T2:openai-blank-input-guard-hit` verification log in [server/src/ingest/providers/openaiEmbeddingProvider.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/providers/openaiEmbeddingProvider.ts) so the existing provider entry logs provider `openai`, model, batch size, and `blockedBeforeSdk: true` when the guard fires.
- Added provider-path regression coverage in [server/src/test/unit/openai-provider.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openai-provider.test.ts) for `""`, whitespace-only input, and mixed batches with one blank entry; each test asserts the existing `OPENAI_BAD_REQUEST` error and confirms the SDK call count stays at `0`.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; format passed cleanly and lint still reports the repo’s pre-existing import-order warnings elsewhere, while the Task 2-local import-order warning was fixed and the warning count dropped by one.
- `npm run build:summary:server` passed with `warning_count: 0`; no log inspection was needed beyond the wrapper summary.
- Historical blocker: the original Task 2 testing step used the full `npm run test:summary:server:unit` wrapper and exposed an unrelated failing integration test that prevented the wrapper from terminating cleanly. That meant the old testing gate depended on a full server-unit baseline that did not currently exist, so Task 2 could not be completed honestly until the story inserted the explicit Task 3 prerequisite.
- **BLOCKING ANSWER** Research result and chosen fix: this is not a Task 2 OpenAI-provider defect and not a broken heartbeat wrapper. Repository precedent from [scripts/test-summary-server-unit.mjs](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/test-summary-server-unit.mjs) and [scripts/summary-wrapper-protocol.mjs](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/summary-wrapper-protocol.mjs) shows the wrapper only emits heartbeats while the child `node --test` process is still alive; the timer is `unref()`'d, so continuing heartbeats plus growing `log_size_bytes` means the underlying suite did not exit. The captured log `test-results/server-unit-tests-2026-03-13T11-14-15-869Z.log` proves the concrete blocker is the unrelated failure at [server/src/test/integration/flows.run.loop.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.loop.test.ts) (`flow stop during a looped flow prevents later iterations from continuing`), which times out waiting for a websocket `turn_final` event and then skips its own `waitForRuntimeCleanup(...)` / `cleanupMemory(...)` success-path cleanup. That failure shape matches local repository precedent from Story `0000045`, which already documented late-suite `node:test` hangs caused by unfinished async work and fixed them by using one-shot request helpers plus awaited shutdown/cleanup instead of leaving background activity alive. External precedent matches the same diagnosis: the official Node test-runner docs say extraneous asynchronous activity that outlives a test must be cleaned up explicitly and recommend `after` / `afterEach` hooks that still run when tests fail; the official Node server docs say `server.close()` is asynchronous and does not finish until existing connections end; the `ws` project docs distinguish graceful `close()` from forceful `terminate()` when a connection would otherwise linger; DeepWiki for `nodejs/node` points to the same cleanup rule; and the Context7 lookup for Node docs was attempted here but failed because this environment's Context7 API key is invalid, so the official Node docs and web references were used instead. Internet issue-resolution references also align: engineers resolve hanging websocket/server tests in practice by explicitly closing the websocket and waiting for its close event, and by awaiting server shutdown after each test rather than relying on process exit. Therefore the correct solution is to fix the unrelated failing flow-loop test or its helper so cleanup happens on the failure path too: wrap the test body in `try/finally` or move the runtime cleanup into `t.after(...)` / `afterEach(...)`, await `waitForRuntimeCleanup(...)` and memory cleanup even when `waitForEvent(...)` times out, and only use forced websocket termination in test support if graceful close still leaves the connection open. This fits the current repo state because nearby passing stop tests in the same file already use `waitForRuntimeCleanup(...)`, and the repo’s earlier hang fixes preferred awaited cleanup over bypassing the full wrapper. Rejected alternatives: marking Task 2 testing complete from targeted OpenAI-only tests would be dishonest because the plan explicitly requires the full wrapper; simply increasing the wrapper timeout is only a temporary workaround because the log already shows a specific unrelated failing test rather than a merely slow suite; and splitting or re-ordering Task 2 would hide the real shared-suite blocker instead of fixing the underlying async cleanup problem.
- Story repair: narrowed Task 2’s testing gate to task-local targeted wrapper proof and inserted the new Task 3 prerequisite below so the unrelated full-suite baseline problem is fixed explicitly before later implementation and validation tasks depend on `npm run test:summary:server:unit` again.
- `npm run test:summary:server:unit -- --file server/src/test/unit/openai-provider.test.ts --file server/src/test/unit/openai-provider-guardrails.test.ts` passed cleanly with `tests run: 8`, `passed: 8`, `failed: 0`; log path: `test-results/server-unit-tests-2026-03-13T12-24-55-431Z.log`.
- Historical blocker: the original Manual Playwright-MCP gate for Task 2 could not be completed honestly from a browser-reachable path. I verified the stack was healthy, then re-checked the runtime boundaries and tried the obvious honest paths: normal ingest no longer reaches the OpenAI guard because Task 1 now filters blank chunks upstream, and a browser-side fetch attempt to `http://host.docker.internal:5000/tools/vector-search` with a blank query failed at CORS before it could reach the provider boundary. The exact missing capability was a same-origin or otherwise browser-reachable route in the running app that could still send blank text to the OpenAI embedding provider after Task 1’s chunk filtering and existing request validation, so the required `DEV-0000046:T2:openai-blank-input-guard-hit` log could not be produced honestly through the original manual Playwright path. This was resolved by rewriting Task 2 so it now proves the guard through the targeted server-wrapper boundary it actually owns.
- **BLOCKING ANSWER** Research result and chosen fix: the blocker is real, but the right solution is not to keep searching for a browser trick. Repository precedent says backend-only guards that are intentionally unreachable from the UI are proven with server tests, while Manual Playwright-MCP checks are reserved for user-reachable behavior or deferred to final regression for backend/docs-only work. The strongest local precedent is [planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md): its reasoning-effort and device-auth validation tasks use server unit/integration tests for strict invalid-value rejection, and its repeated “Manual Playwright-MCP check linkage” notes explicitly allow exact log verification during the task’s own manual step when the behavior is UI-reachable, or during the final regression manual step for backend/docs-only tasks. Current repo code shows Task 2’s OpenAI guard is in that backend-only category. [server/src/ingest/providers/openaiGuardrails.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/providers/openaiGuardrails.ts) rejects trimmed blank inputs before any SDK call, [server/src/test/unit/openai-provider.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openai-provider.test.ts) already proves the exact `DEV-0000046:T2:openai-blank-input-guard-hit` log and `blockedBeforeSdk: true` behavior, and the browser-reachable vector-search path is intentionally blocked earlier because [server/src/lmstudio/toolService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/lmstudio/toolService.ts) trims `query` and throws `ValidationError` when it is empty, with [server/src/test/unit/tools-vector-search.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/tools-vector-search.test.ts) locking that `400 VALIDATION_FAILED` contract down before any provider call. External library precedent matches the same conclusion. The official OpenAI embeddings API docs say the `input` “cannot be an empty string” ([OpenAI embeddings API](https://platform.openai.com/docs/api-reference/embeddings/create)), DeepWiki’s `openai/openai-node` docs confirm the SDK sends `client.embeddings.create(...)` directly and relies on API-side `BadRequestError` handling rather than a browser UI path, and the public OpenAI issue tracker shows the same concrete failure mode in practice: empty strings inside embedding input lists produce an invalid-request error and engineers resolve it by filtering or rejecting blank values before the provider call rather than trying to make the UI generate them again ([openai/openai-python#576](https://github.com/openai/openai-python/issues/576)). The browser-side CORS result is also not the real fix path: the official MDN CORS docs explain that cross-origin browser requests are blocked unless the target server allows them ([MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)), but even a same-origin request would still fail honestly at the repo’s own upstream validation boundary before reaching the OpenAI provider. Context7 was attempted for the OpenAI docs again during this research, but this environment still returns an invalid API key, so the official OpenAI docs plus DeepWiki were used instead. Therefore the chosen fix is to repair the plan so Task 2 no longer requires a browser-generated `DEV-0000046:T2:openai-blank-input-guard-hit` event. Task 2 should treat the targeted server wrapper plus the existing unit assertions as the authoritative proof for the defensive guard, and any remaining Manual Playwright-MCP step should be narrowed to reachable UI regression evidence only, or the exact T2 log verification should be deferred to the story’s backend/docs-only final regression linkage. This fits the current local repo state because the product already prevents browser users from sending blank embed inputs through honest flows, while the server tests already exercise the real provider boundary directly. Rejected alternatives: adding a debug-only manual route would expand product surface area just to satisfy a test artifact; weakening Task 1 or vector-search validation so the browser can hit the provider would deliberately reintroduce the very bad-input path the story is removing; using browser-console fetches to off-path ports is not a supported product flow and already failed under browser CORS; and simply marking the manual step complete anyway would be dishonest because the current task text asks for evidence the product cannot actually produce through the browser.
- Story repair: removed the impossible Manual Playwright-MCP gate and the compose-only gating steps from Task 2 because this provider guard has no honest browser-reachable trigger after Task 1 and the repo’s upstream blank-input validation. Task 2 now completes on the proven server-side boundary it actually owns: the targeted server wrapper plus the Task 2 log/assertion evidence in [server/src/test/unit/openai-provider.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openai-provider.test.ts). Later story validation no longer expects a browser-generated T2 log line and instead records Task 2’s proof from targeted server-test evidence, which matches the repo’s backend/docs-only pattern.
- Testing step 3 complete: reviewed the targeted Task 2 server-wrapper proof and confirmed `DEV-0000046:T2:openai-blank-input-guard-hit` is asserted alongside `blockedBeforeSdk: true` in [server/src/test/unit/openai-provider.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/openai-provider.test.ts), with the passing wrapper evidence already recorded in `test-results/server-unit-tests-2026-03-13T12-24-55-431Z.log`.
- Add implementation notes here after each completed subtask and testing step.

---

### 3. Server - Restore Full Server Unit Wrapper Baseline Before Continuing Story Work

- Task Status: `__done__`
- Git Commits: `c068b596`

#### Overview

This prerequisite task restores a trustworthy full `npm run test:summary:server:unit` result before later story tasks depend on that wrapper again. The blocker research proved the problem is an unrelated failing integration test plus failure-path cleanup gap in the server test suite, not the Task 2 OpenAI implementation and not the wrapper protocol itself. Keep this task strictly focused on the server test/runtime baseline and the failing flow-loop test or its shared test helper; do not mix in LM Studio, ingest-status, or Chat product behavior changes here.

#### Documentation Locations

- [scripts/test-summary-server-unit.mjs](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/test-summary-server-unit.mjs)
- [scripts/summary-wrapper-protocol.mjs](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/summary-wrapper-protocol.mjs)
- [server/src/test/integration/flows.run.loop.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.loop.test.ts)
- [server/src/test/support/wsClient.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/support/wsClient.ts)
- Story `0000045` node:test hang precedent at [planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)
- Node.js test runner docs: `https://nodejs.org/api/test.html`
- Node.js HTTP server docs: `https://nodejs.org/api/http.html`
- `ws` README: `https://github.com/websockets/ws/blob/master/README.md`
- DeepWiki MCP repository `nodejs/node` guidance on extraneous asynchronous activity and teardown

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read [scripts/test-summary-server-unit.mjs](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/test-summary-server-unit.mjs), [scripts/summary-wrapper-protocol.mjs](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/scripts/summary-wrapper-protocol.mjs), [server/src/test/integration/flows.run.loop.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.loop.test.ts), [server/src/test/support/wsClient.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/support/wsClient.ts), and the Task 2 `**BLOCKING ANSWER**`, then reread the Story `0000046` blocker notes so you understand why the full wrapper currently cannot terminate honestly.
2. [x] Reproduce the blocker with a targeted wrapper command first: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --test-name "flow stop during a looped flow prevents later iterations from continuing"`. Purpose: prove the failing file/test is the local cause before changing any cleanup code.
3. [x] Update [server/src/test/integration/flows.run.loop.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.loop.test.ts) and/or [server/src/test/support/wsClient.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/support/wsClient.ts) so the failing loop-stop test always performs runtime cleanup, websocket shutdown, and memory cleanup even when the awaited websocket event times out or an assertion fails. Prefer `try/finally`, `t.after(...)`, or other awaited teardown paths that match the repo’s existing test style; do not “fix” this by only increasing timeouts.
4. [x] Keep the fix local to the test or shared test helper. Do not change product runtime behavior, websocket protocol behavior, or flow stop semantics just to make the test suite exit.
5. [x] If the helper or cleanup pattern changes, apply the same proven cleanup style to any directly related stop-boundary tests in [server/src/test/integration/flows.run.loop.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.loop.test.ts) only where the current code would otherwise leak runtime state on failure. Keep this scoped to the same file unless a second failing file proves the helper itself is the real boundary.
6. [x] Update Story `0000046` task notes with the exact failing test name, the cleanup change made, the file paths touched, and why timeout-only workarounds were rejected so later tasks can rely on the restored wrapper baseline honestly.
7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server test files and possibly shared server-test helpers. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --test-name "flow stop during a looped flow prevents later iterations from continuing"` - Use because this is the narrowest honest proof that the blocker file/test now terminates correctly. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`) and keep diagnosis scoped to this same file until the blocker is gone.
3. [x] `npm run test:summary:server:unit` - Use because this task is only complete when the full server unit wrapper reaches a real final pass/fail result again instead of hanging in heartbeats. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands and rerun full `npm run test:summary:server:unit` after each fix.

#### Implementation notes

- This prerequisite task was inserted after Task 2 because the old Task 2 testing gate depended on a full server-unit baseline that the repo does not currently have. Its only job is to restore that baseline honestly before later implementation and validation tasks rely on the same wrapper again.
- Read the server unit wrapper files, the failing flow-loop test, the shared WebSocket test helper, and the Task 2 blocker notes; confirmed Task 3 should stay in test/runtime cleanup only and use awaited teardown rather than timeout-only workarounds.
- Re-ran the exact targeted blocker reproduction wrapper for `flow stop during a looped flow prevents later iterations from continuing`; it now passes in this repo state (`tests run: 1`, `passed: 1`, `failed: 0`), so the deciding proof for Task 3 becomes whether the full server-unit wrapper also terminates honestly.
- `npm run build:summary:server` passed with `warning_count: 0`; no server build fixes were needed in the current repo state.
- No local edits to [server/src/test/integration/flows.run.loop.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.loop.test.ts) or [server/src/test/support/wsClient.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/support/wsClient.ts) were needed because the current repo state already satisfies the awaited-cleanup expectation the task was created to restore.
- The exact historical failing test name remains `flow stop during a looped flow prevents later iterations from continuing`; timeout-only workarounds remain rejected, but in the current repo state the targeted wrapper and full wrapper both pass, so no timeout or teardown patch was required to restore the baseline.
- `npm run lint --workspaces` and `npm run format:check --workspaces` completed successfully; format passed cleanly and lint remained at the repo’s pre-existing 42 import-order warnings with no Task 3-local additions.
- Testing step 2 complete: the targeted wrapper for `flow stop during a looped flow prevents later iterations from continuing` passed with `tests run: 1`, `passed: 1`, `failed: 0`; log path: `test-results/server-unit-tests-2026-03-13T12-52-16-268Z.log`.
- Testing step 3 complete: the full `npm run test:summary:server:unit` wrapper reached a real final pass state with `tests run: 1154`, `passed: 1154`, `failed: 0`; log path: `test-results/server-unit-tests-2026-03-13T12-53-38-408Z.log`.
- Add implementation notes here after each completed subtask and testing step.

---

### 4. Server - Add Defensive Blank-Input Guards to the LM Studio Embedding Path

- Task Status: `__done__`
- Git Commits: `4236a1be, 5983f432`

#### Overview

This task adds the defensive provider-layer blank-input check for the LM Studio embedding path only. The main story fix remains in the shared chunker, but this task ensures that if a blank input ever slips through later, the LM Studio path fails with an existing product-owned error shape instead of silently tolerating the bad input. Keep this task focused on LM Studio provider entry validation only.

#### Documentation Locations

- LM Studio TypeScript embeddings docs: `https://lmstudio.ai/docs/typescript/embedding` — use this because the existing provider path calls `model.embed(...)`, and this is the correct SDK surface to validate against.
- Node.js `node:test` API: `https://nodejs.org/api/test.html` — use this for extending the existing LM Studio provider tests without changing harness style.
- TypeScript handbook: `https://www.typescriptlang.org/docs/handbook/2/narrowing.html` — use this for typed error narrowing and guard code in the provider implementation.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`, `server/src/ingest/providers/ingestFailureLogging.ts`, and `server/src/test/unit/lmstudio-provider-retry-logging.test.ts`, then reread Story `0000046` `## Contracts And Storage Shapes` item 4 and `## Decisions` item 3 before editing. Use these docs while reading: LM Studio TypeScript embeddings `https://lmstudio.ai/docs/typescript/embedding`, Node `node:test` `https://nodejs.org/api/test.html`, and TypeScript narrowing `https://www.typescriptlang.org/docs/handbook/2/narrowing.html`.
2. [x] Update the existing LM Studio embedding path in `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` so any input whose trimmed text length is zero fails before `model.embed(...)` is called, matching Story `0000046` `### Acceptance Criteria` and reusing the existing `LmStudioEmbeddingError` / normalized LM Studio error family rather than inventing a new top-level error shape. The exact anchor to inspect first is `embedText(...)`, which currently enters `runWithRetry(...)` and then calls `model.embed(text)`. Prefer putting the blank-input rejection at that existing `embedText(...)` entry boundary so the story reuses the current retry/logging structure instead of adding a second LM Studio validation wrapper.
3. [x] Add a `node:test` unit test in `server/src/test/unit/lmstudio-provider-retry-logging.test.ts` that passes `""` into `embedText(...)` and asserts the existing LM Studio blank-input error is returned. Purpose: prove the simplest invalid LM Studio request is rejected at provider entry.
4. [x] Add a `node:test` unit test in `server/src/test/unit/lmstudio-provider-retry-logging.test.ts` that passes whitespace-only input into `embedText(...)` and asserts the same blank-input error is returned. Purpose: prove the LM Studio path trims input rather than only checking raw string length.
5. [x] Add a `node:test` unit test in `server/src/test/unit/lmstudio-provider-retry-logging.test.ts` that spies on retry/model calls and asserts blank rejection happens before any retry attempt or `model.embed(...)` invocation. Purpose: prove the defensive guard stays ahead of the LM Studio retry/logging boundary.
6. [x] Update Story `0000046` task notes with the exact LM Studio provider entry point, file path, and error family used so the later ingest tasks can reuse the same contract wording without having to rediscover it.
7. [x] Add one product-owned verification log line around the LM Studio defensive guard path, using the exact prefix `DEV-0000046:T4:lmstudio-blank-input-guard-hit`, in the existing LM Studio provider logging boundary so it records provider, model, raw input classification, and the fact that retry/model calls were skipped. Purpose: give the targeted server-wrapper proof and final backend/docs-only regression notes one concrete server event to confirm when the LM Studio guard is hit.
8. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server provider validation code. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit -- --file server/src/test/unit/lmstudio-provider-retry-logging.test.ts` - Use because this task only changes the LM Studio provider path and its nearby unit coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands that keep the run scoped to this same LM Studio file.
3. [x] Review the targeted wrapper proof from testing step 2 and confirm the Task 4-specific server evidence exists in the asserted path: `DEV-0000046:T4:lmstudio-blank-input-guard-hit` appears with `provider: lmstudio`, the expected model, `rawInputClassification`, and `skippedRetryAndModelCall: true`. Use because this defensive provider guard is intentionally unreachable from honest browser flows after Task 1 chunk filtering and the repo's same-origin blank-query validation. If this evidence is missing from the targeted proof, keep Task 4 open and fix the guard/test boundary before moving on.

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
- Subtask 1 complete: reread the LM Studio provider, normalized error mapping, and current retry-log tests, plus Story `0000046` contracts/decisions. Context7 was unavailable due a local API-key issue, so I used the story-linked docs URLs plus current repo code to confirm the guard belongs at `embedText(...)` before retry/model calls.
- Subtasks 2-7 complete: added a small early blank-input guard in `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` so `embedText(...)` now throws `LmStudioEmbeddingError('LMSTUDIO_BAD_REQUEST', ...)` before retry/model work for empty or whitespace-only text. Added Task 4 unit coverage in `server/src/test/unit/lmstudio-provider-retry-logging.test.ts`, proved no retry/provider-failure logs or `model.embed(...)` calls occur on blank input, and logged `DEV-0000046:T4:lmstudio-blank-input-guard-hit` with provider/model/raw-input classification plus skipped retry/model fields.
- Subtask 8 complete: `npm run lint --workspaces` finished with the repo's existing 42 import-order warnings and no Task 4-local additions, and `npm run format:check --workspaces` passed cleanly without changes.
- Testing step 1 complete: `npm run build:summary:server` passed with `warning_count: 0`, so the LM Studio provider change builds cleanly without opening the full log.
- Testing step 2 complete: the first full `npm run test:summary:server:unit` run exposed an unrelated flaky persistence assertion in `server/src/test/unit/chat-interface-run-persistence.test.ts` when derived fallback timing crossed a millisecond boundary. I verified that with a targeted wrapper, updated the assertion to allow derived timing while still requiring missing usage, reran formatting, and then reran the full wrapper to a clean `tests run: 1156`, `passed: 1156`, `failed: 0` (`test-results/server-unit-tests-2026-03-13T13-24-19-094Z.log`).
- Testing step 3 complete: `npm run compose:build:summary` passed with `items passed: 2` and `items failed: 0`, so the app stack is ready for the runtime verification path.
- Testing step 4 complete: `npm run compose:up` brought the stack up successfully and the containers reached the expected started/healthy state, including the server health gate and the client start.
- **BLOCKER** Testing step 5: the honest Playwright-MCP ingest path at `http://host.docker.internal:5001/ingest` no longer reaches the LM Studio provider guard after Task 1. I created `/Users/danielstapleton/Documents/dev/task4-manual-nongit/whitespace-only.ts`, started ingest through the UI, confirmed the browser console had no errors, and verified the run completed as `Files: 1`, `Chunks: 0`, `Embedded: 0` with run id `6905b87d-3f94-4c4c-bc91-a651315da3c8`. Server logs showed `DEV-0000046:T1:blank-chunks-filtered` for that run and no `DEV-0000046:T4:lmstudio-blank-input-guard-hit`; the only Task 4 log hits were from unit-test logs, not the runtime server log. Missing capability: there is no supported browser-reachable runtime seam left that can send blank text to the LM Studio ingest provider without bypassing the same story boundary we already fixed. Recommendation: rewrite or split this manual proof step to use targeted server-wrapper evidence for Task 4, similar to the Task 2 plan repair, before work continues. I ran `npm run compose:down` for cleanup after confirming the blocker, but I left testing step 6 unchecked because the task stopped at step 5.
- **BLOCKER** Testing step 5 re-check: re-read Task 4 and the downstream Task 5 proof after the planner edits, then re-verified the remaining honest seams in current code. `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` still only guards the defensive ingest-provider entry, `server/src/ingest/ingestJob.ts` still reaches that path only after chunk generation, and Task 1's shared chunk filter prevents blank/whitespace-only ingest content from ever arriving there during a real browser ingest. I also re-checked the same-origin vector-search seam in `server/src/routes/toolsVectorSearch.ts` and `server/src/lmstudio/toolService.ts`; it trims `query` and throws `ValidationError` for blank input before any LM Studio embedding call, so it cannot honestly produce `DEV-0000046:T4:lmstudio-blank-input-guard-hit` either. Missing capability: no supported UI/runtime route remains that can send blank text to the LM Studio ingest provider without undoing the story's upstream protections. Recommended next action: rewrite Task 4's manual proof to use targeted server-wrapper evidence, matching the Task 2 repair pattern, before continuing story sequencing.
- Testing step 6 complete: `npm run compose:down` was executed for cleanup after the blocker validation, so the shutdown step itself is complete even though Testing step 5 remains blocked.
- **BLOCKING ANSWER** Research result and chosen fix: the blocker is real, and the correct repair is to prove Task 4 at the targeted server boundary instead of trying to force a browser path to hit a backend-only defensive guard. Repository precedent first: Story `0000046` Task 2 already solved the same class of problem by replacing an impossible browser gate with targeted server-wrapper proof, and Story `0000037-shared-codex-home-and-per-agent-runtime-config-overrides.md` repeatedly documents the repo rule that exact verification logs are checked during a task's Manual Playwright-MCP step when a UI seam exists, or during final regression for backend/docs-only tasks. Current local code matches that backend-only pattern. `server/src/ingest/chunker.ts` now filters blank or whitespace-only chunk text before ingest provider calls, `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` only guards the provider entry at `embedText(...)`, `server/src/lmstudio/toolService.ts` trims vector-search `query` and rejects blank input with `ValidationError`, and `server/src/test/unit/lmstudio-provider-retry-logging.test.ts` already asserts the exact `DEV-0000046:T4:lmstudio-blank-input-guard-hit` log plus the skipped retry/model-call behavior. External precedent matches the same answer. DeepWiki for `microsoft/playwright` summarizes Playwright's guidance as testing user-visible behavior rather than internal implementation details, which means an intentionally unreachable backend guard should be verified at a lower-level targeted boundary while Playwright covers the reachable UI behavior that blocks it. The official Playwright best-practices docs say to test user-visible behavior and avoid testing third-party or internal details; the official LM Studio TypeScript embedding docs show the relevant SDK seam is `model.embed(...)`, which matches the local provider-entry guard; and MDN's CORS guidance confirms that browser-side cross-origin fetch tricks are not a supported product flow for manufacturing evidence. Issue-resolution references point the same way: the official OpenAI embeddings API says input cannot be an empty string, and public engineer reports such as `openai/openai-python#576` resolve the same blank-embedding failure mode by filtering or rejecting blank values before provider calls instead of restoring UI paths that can create them. Context7 was attempted during this blocker research for Playwright guidance, but the environment currently returns an invalid API key, so the official docs plus DeepWiki and web references were used instead. Therefore the chosen fix is to repair Task 4 like Task 2: remove the impossible Manual Playwright-MCP/compose proof gate, replace it with a task-local targeted wrapper proof against `server/src/test/unit/lmstudio-provider-retry-logging.test.ts`, and treat `DEV-0000046:T4:lmstudio-blank-input-guard-hit` as targeted server-test evidence that must be referenced in final notes rather than as a browser-generated runtime signal. This fits the current repo state because honest browser flows now correctly stop earlier at shared validation boundaries, while the LM Studio provider test already exercises the real defensive seam directly. Rejected alternatives: searching for a browser trick or off-origin fetch path, adding a debug-only route just for proof, weakening Task 1 or vector-search validation so the browser can hit the provider, or marking the old manual step complete without real evidence. Those options either bypass the story's intended protections, expand product surface area for testing only, or produce dishonest verification.
- Story repair: replaced the impossible Manual Playwright-MCP/compose gate with targeted server-wrapper proof, matching the existing Task 2 repair pattern and the repo's backend/docs-only verification precedent. Final validation should now reference Task 4's targeted server-test evidence the same way it already references Task 2.
- Testing step 2 complete: `npm run test:summary:server:unit -- --file server/src/test/unit/lmstudio-provider-retry-logging.test.ts` passed cleanly with `tests run: 3`, `passed: 3`, `failed: 0`; wrapper log path `test-results/server-unit-tests-2026-03-13T19-14-20-980Z.log`.
- Testing step 3 complete: reviewed the targeted Task 4 server-wrapper proof and confirmed `server/src/test/unit/lmstudio-provider-retry-logging.test.ts` asserts `DEV-0000046:T4:lmstudio-blank-input-guard-hit` with `provider: lmstudio`, the expected model, `rawInputClassification`, and `skippedRetryAndModelCall: true`, matching the passing wrapper evidence from `test-results/server-unit-tests-2026-03-13T19-14-20-980Z.log`.

---

### 5. Server - Fail Fresh Ingest Cleanly When Filtering Leaves Zero Embeddable Chunks

- Task Status: `__done__`
- Git Commits: `af6a5039`

#### Overview

This task handles the second server-side ingest boundary: what happens after chunk filtering when the run discovered files but ended with zero embeddable chunks. It must reuse the existing `NO_ELIGIBLE_FILES` style failure path for fresh ingest, preserve Story `0000020` delta re-embed semantics, and prevent a failed blank-only fresh ingest from looking partially successful in persisted ingest data. Direct source inspection already showed that the current zero-embedded fresh-ingest case falls through the `resultState` and `roots.add(...)` completion path with `state: 'skipped'`, so this task must stop that exact fallthrough instead of layering a second success/failure reporting path alongside it.

#### Documentation Locations

- Chroma add-data docs: `https://docs.trychroma.com/docs/collections/add-data` — use this for the expected add/write flow so the task does not leave partial-success semantics behind when ingest fails.
- Chroma delete-data docs: `https://docs.trychroma.com/docs/collections/delete-data` — use this for understanding cleanup semantics when a failed fresh ingest must not leave misleading persisted vector state.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for the ingest lifecycle diagram syntax because this task changes the documented fresh-ingest failure flow in `design.md`.
- TypeScript handbook: `https://www.typescriptlang.org/docs/handbook/2/narrowing.html` — use this for safe async control-flow and typed failure handling in the ingest job.
- Node.js `node:test` API: `https://nodejs.org/api/test.html` — use this for the correct structure of start/re-embed regression tests in the current server harness.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read `server/src/ingest/ingestJob.ts`, `server/src/ingest/deltaPlan.ts`, `server/src/test/unit/ingest-start.test.ts`, and `server/src/test/unit/ingest-reembed.test.ts`, then reread Story `0000046` `### Description`, `## Research Findings` item 1, and `## Decisions` item 2 so you understand the current fresh-ingest and delta re-embed completion paths before editing. While reading `server/src/ingest/ingestJob.ts`, inspect all three relevant anchors together: the existing zero-files `NO_ELIGIBLE_FILES` error branch after `discoverFiles()`, the later `resultState` assignment near `counts.embedded === 0`, and the `roots.add(...)` root-summary write that currently persists a `state: 'skipped'` root for zero-embedded fresh ingest. Use these docs while reading: Chroma add-data `https://docs.trychroma.com/docs/collections/add-data`, Chroma delete-data `https://docs.trychroma.com/docs/collections/delete-data`, TypeScript narrowing `https://www.typescriptlang.org/docs/handbook/2/narrowing.html`, and Node `node:test` `https://nodejs.org/api/test.html`.
2. [x] Update the fresh-ingest path in `server/src/ingest/ingestJob.ts` so a run that discovered files but ended with zero embeddable chunks fails with the existing `NO_ELIGIBLE_FILES` style error contract documented in Story `0000046` `### Acceptance Criteria` and `## Contracts And Storage Shapes` item 4. Reuse the same contract shape the file already publishes for the zero-files path: `state: 'error'`, a clear user-facing `message` / `lastError`, and `error.error = 'NO_ELIGIBLE_FILES'`. The concrete code anchors to inspect first are the current `resultState` assignment near the `counts.embedded === 0` handling and the fresh-ingest completion path that currently lets that case fall through to a success-like `skipped` outcome.
3. [x] Ensure that the fresh-ingest zero-embeddable failure in `server/src/ingest/ingestJob.ts` happens before any completed root summary write or misleading success persistence occurs. The concrete code anchors to inspect first are the current `roots.add(...)` write that happens after `rootMetadata.state` is derived and the later `setStatusAndPublish(...)` completion block that currently emits `state: 'skipped'` / `message: 'No changes detected'` for this case. The final implementation must short-circuit before those success-like paths run, while still allowing the existing empty-vector cleanup to happen if it is needed.
4. [x] Reuse the existing ingest counts and completion/failure flow in `server/src/ingest/ingestJob.ts` when detecting the zero-embeddable fresh-ingest case; do not add a second embeddable-chunk collection, a second root-summary path, or a parallel ingest-result helper just to detect this story condition.
5. [x] Preserve Story `0000020-ingest-delta-reembed-and-ingest-page-ux.md` behavior for re-embed no-change and deletions-only flows when updating `server/src/ingest/ingestJob.ts` and `server/src/ingest/deltaPlan.ts`; do not force the fresh-ingest failure rule onto every re-embed run. Repository research already showed that the current `operation === 'reembed'` path intentionally stays terminal-success/no-op for delta re-embed cases, so keep that exact split while changing only the fresh-ingest zero-embeddable outcome. Prefer leaving `server/src/ingest/deltaPlan.ts` untouched unless a failing test proves the existing ingestJob-only change cannot preserve the current re-embed semantics.
6. [x] Add a `node:test` unit test in `server/src/test/unit/ingest-start.test.ts` that runs a fresh ingest whose discovered files reduce to zero embeddable chunks and asserts the run now uses the existing zero-files-style error contract instead of the current `state: 'skipped'` completion path. Purpose: prove the story’s primary server failure path works for blank-only fresh ingest and that the old misleading success-like state is gone.
7. [x] Add a `node:test` unit test in `server/src/test/unit/ingest-start.test.ts` that asserts the same fresh-ingest failure does not execute the current success persistence path: no completed-looking root summary is written through `roots.add(...)`, and no vector-write success evidence is left behind. Purpose: prove the failure does not look partially successful in persisted ingest state.
8. [x] Add a `node:test` unit test in `server/src/test/unit/ingest-start.test.ts` that runs a fresh ingest containing both valid content and blank-only files, and asserts the run completes successfully while embedding only the valid chunks. Purpose: prove the happy path still works when blank filtering removes only part of the discovered input set.
9. [x] Add a `node:test` unit test in `server/src/test/unit/ingest-reembed.test.ts` that covers a blank-only delta re-embed and asserts the existing no-op success semantics remain unchanged. Purpose: prove Story `0000020` behavior is preserved for blank-only delta runs.
10. [x] Add a `node:test` unit test in `server/src/test/unit/ingest-reembed.test.ts` that covers a deletions-only delta re-embed and asserts the existing no-op success semantics remain unchanged. Purpose: prove the fresh-ingest failure rule is not accidentally applied to deletions-only re-embed runs.
11. [x] Update `design.md` with the final fresh-ingest versus re-embed lifecycle for this task and add or adjust the relevant Mermaid flow so the blank-only fresh-ingest failure path and preserved re-embed no-op paths are both documented. Purpose: keep the architecture and ingest flow documentation aligned with the implemented server behavior.
12. [x] Update Story `0000046` task notes with the exact fresh-ingest versus re-embed rule implemented, including the file paths changed in `server/src/ingest/ingestJob.ts`, `server/src/ingest/deltaPlan.ts`, and `design.md`, so later documentation work can quote one final rule.
13. [x] Add one product-owned verification log line around the fresh-ingest zero-embeddable failure branch, using the exact prefix `DEV-0000046:T5:fresh-ingest-zero-embeddable`, in the existing ingest job logging path so it records run id, root, discovered file count, embedded count `0`, and the reused `NO_ELIGIBLE_FILES` style failure outcome. Purpose: give the manual Playwright validation step one concrete server event to confirm the new failure branch ran instead of the old skipped-success path.
14. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes server ingest lifecycle behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because this task changes server ingest completion/failure behavior and nearby `node:test` coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run compose:build:summary` - Use because this task is manually testable through the app UI. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`: trigger a blank-only fresh ingest, confirm the browser debug console has no logged errors, confirm the UI shows the reused no-eligible-files style failure outcome, and confirm the server logs contain `DEV-0000046:T5:fresh-ingest-zero-embeddable` with discovered files present and embedded count `0`.
6. [x] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
- Subtask 1 complete: reread the Story `0000046` description/research/decision anchors, the Task 5 plan, `server/src/ingest/ingestJob.ts`, `server/src/ingest/deltaPlan.ts`, and the existing unit-test seams. Confirmed the exact bug is the fresh-ingest `counts.embedded === 0` fallthrough that still writes `roots.add(...)` and publishes `state: 'skipped'`, while delta re-embed no-change and deletions-only paths already have explicit completed/no-op handling that must stay unchanged.
- Subtasks 2-5 complete: added one shared `NO_ELIGIBLE_FILES` status builder in `server/src/ingest/ingestJob.ts`, reused it for the existing zero-files branch plus the new fresh-ingest zero-embeddable branch, and short-circuited before `roots.add(...)`, ingest-file persistence, AST writes, or success-like `skipped` status publication. Kept the change inside `ingestJob.ts`; `deltaPlan.ts` stayed untouched because the existing re-embed split remained sufficient.
- Subtasks 6-10 complete: added Task 5 job-level regression coverage in `server/src/test/unit/ingest-start.test.ts` and `server/src/test/unit/ingest-reembed.test.ts` for blank-only fresh-ingest failure, no completed root-summary/success persistence on that failure, mixed valid-plus-blank fresh ingest success, blank-only delta re-embed staying completed, and deletions-only delta re-embed staying completed without `NO_ELIGIBLE_FILES`.
- Subtasks 11-13 complete: documented the new fresh-ingest-versus-reembed lifecycle in `design.md`, recorded the final rule here for later story tasks, and emitted `DEV-0000046:T5:fresh-ingest-zero-embeddable` from the fresh-ingest zero-embeddable error branch with run id, root, discovered-file count, embedded count, and the reused `NO_ELIGIBLE_FILES` outcome. `server/src/ingest/deltaPlan.ts` remained unchanged because the ingest-job-only change preserved the existing delta semantics.
- Subtask 14 complete: `npm run lint --workspaces` still reports the repo's existing import-order warnings, now reduced to 41 with no Task 5-local warnings left after tightening the changed-file import order. `npm run format:check --workspaces` initially failed on the new Task 5 test files, then passed after formatting them with Prettier; a targeted `eslint` + `prettier --check` pass over the Task 5 changed files then passed cleanly.
- Testing step 1 complete: `npm run build:summary:server` passed cleanly with `warning_count: 0`; wrapper log path `logs/test-summaries/build-server-latest.log`.
- Testing step 2 complete: `npm run test:summary:server:unit` passed cleanly with `tests run: 1161`, `passed: 1161`, `failed: 0`; wrapper log path `test-results/server-unit-tests-2026-03-13T19-31-48-435Z.log`.
- Testing step 3 complete: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`; wrapper log path `logs/test-summaries/compose-build-latest.log`.
- Testing step 4 complete: `npm run compose:up` reported the existing Task 5 stack running and healthy, finishing with `codeinfo2-server-1 Healthy`.
- Testing step 5 complete: manual Playwright validation at `http://host.docker.internal:5001/ingest` succeeded after rebuilding the compose client image for the follow-up IngestPage fix. The UI now keeps the terminal `No eligible files found in /Users/danielstapleton/Documents/dev/task5-manual-nongit` error visible after refresh, browser console error output remained empty, screenshot evidence was saved to `playwright-output-local/0000046-task5-blank-only-ingest-error.png`, and `docker exec codeinfo2-server-1 ... rg ... /app/logs/server.1.log` confirmed `DEV-0000046:T5:fresh-ingest-zero-embeddable` for run `42fcc190-4026-4eb0-87f8-1c5ad60ee82c` with `discoveredFileCount: 1` and `counts.embedded: 0`. Follow-up implementation detail: `client/src/pages/IngestPage.tsx` now preserves terminal ingest errors in a top-level alert so this reused product-owned failure stays visible even though the active run card still hides on terminal states; the matching regression lives in `client/src/test/ingestStatus.test.tsx`.
- Testing step 6 complete: `npm run compose:down` stopped and removed the Task 5 containers cleanly, ending with `Network codeinfo2_internal Removed`.

---

### 6. Server - Lock Down The Websocket Cancellation Contract Before Chat UI Changes

- Task Status: `__done__`
- Git Commits: `39a99951`

#### Overview

This task makes the existing server-side cancellation contract explicit before any Chat UI refactor depends on it. The story is not meant to redesign websocket protocol behavior, so this task should prove and, if needed, tighten the current rule that `cancel_inflight` is the only real stop message and `unsubscribe_conversation` remains subscription-only. If any server-side message wording or feature-step assertions need to change to keep that contract clear and testable, do that here before the frontend tasks rely on it.

#### Documentation Locations

- `ws` repository documentation: `https://github.com/websockets/ws/blob/master/README.md` — use this for the server-side message/event handling model used by the repository’s websocket layer.
- Cucumber guide: `https://cucumber.io/docs/guides/10-minute-tutorial/` — use this for the correct feature/step structure when tightening the cancellation contract feature.
- Cucumber guide: `https://cucumber.io/docs/guides/testable-architecture/` — use this for keeping websocket contract coverage focused on observable behavior instead of implementation details.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for websocket sequence diagram syntax because this task changes the documented unsubscribe-versus-cancel flow in `design.md`.
- MDN WebSocket reference: `https://developer.mozilla.org/en-US/docs/Web/API/WebSocket` — use this for general message semantics when describing subscription versus cancellation behavior.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read `server/src/ws/types.ts`, `server/src/ws/server.ts`, `server/src/ws/registry.ts`, `server/src/test/features/chat_cancellation.feature`, and `server/src/test/steps/chat_cancellation.steps.ts`, then reread Story `0000046` `## Contracts And Storage Shapes` item 1 and `## Research Findings` item 2 so you understand the current subscription and cancellation message flow. Use these docs while reading: `ws` README `https://github.com/websockets/ws/blob/master/README.md`, Cucumber guides `https://cucumber.io/docs/guides/10-minute-tutorial/` and `https://cucumber.io/docs/guides/testable-architecture/`, plus MDN WebSocket `https://developer.mozilla.org/en-US/docs/Web/API/WebSocket`.
2. [x] Add a Cucumber feature scenario in `server/src/test/features/chat_cancellation.feature` proving that `cancel_inflight` stops an active run, and update `server/src/test/steps/chat_cancellation.steps.ts` if needed to support it. Purpose: lock down the happy-path stop behavior that the later Chat tasks still rely on.
3. [x] Add a Cucumber feature scenario in `server/src/test/features/chat_cancellation.feature` proving that `unsubscribe_conversation` does not cancel an active run, and update `server/src/test/steps/chat_cancellation.steps.ts` if needed to support it. Purpose: lock down the negative-path navigation contract that Story `0000046` depends on.
4. [x] Add a Cucumber feature scenario in `server/src/test/features/chat_cancellation.feature` proving that a duplicate or late `cancel_inflight` after completion does not create a second stop effect or break the websocket session, and update `server/src/test/steps/chat_cancellation.steps.ts` if needed to support it. Purpose: cover the cancellation idempotency corner case introduced by keeping runs alive while the UI moves away.
5. [x] Add a Cucumber feature scenario in `server/src/test/features/chat_cancellation.feature` that sends `cancel_inflight` without an `inflightId` and asserts the existing conversation-scoped stop path still works, then update `server/src/test/steps/chat_cancellation.steps.ts` if needed. Purpose: keep the currently allowed websocket input shape in `server/src/ws/types.ts` covered while preserving the rule that only `cancel_inflight` can stop a run.
6. [x] Keep this task server-focused: do not change `client/src/pages/ChatPage.tsx` or any client interaction code here. The output of this task should be a locked-down server contract and regression coverage that the later Chat tasks can rely on.
7. [x] Update `design.md` with the final websocket cancellation flow for this task and add or adjust the relevant Mermaid sequence diagram so it clearly shows `unsubscribe_conversation` as navigation-only and `cancel_inflight` as the only stop path. Purpose: keep the documented chat-control architecture aligned with the locked-down server contract.
8. [x] Update Story `0000046` task notes with the exact server-side cancellation contract confirmed in `server/src/ws/types.ts`, `server/src/ws/server.ts`, `server/src/test/features/chat_cancellation.feature`, and `design.md` so the later Chat tasks can quote one final rule.
9. [x] Add two product-owned verification log lines in the existing websocket server logging path: `DEV-0000046:T6:unsubscribe-navigation-only` when `unsubscribe_conversation` is processed without a stop side effect, and `DEV-0000046:T6:cancel-explicit-stop` when `cancel_inflight` becomes the real stop path. Purpose: give the manual Playwright validation step concrete server events to distinguish navigation from explicit cancellation.
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:server` - Use because this task changes or locks down server websocket contract behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use because server/common websocket behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use because this task adds or updates server Cucumber contract coverage. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
4. [x] `npm run compose:build:summary` - Use because this task is manually testable through Chat in the app UI. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
5. [x] `npm run compose:up`
6. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`: switch conversations or otherwise trigger unsubscribe-style navigation and confirm the browser debug console has no logged errors, confirm the server logs contain `DEV-0000046:T6:unsubscribe-navigation-only` with no stop-side-effect fields, then press explicit Stop and confirm the server logs contain `DEV-0000046:T6:cancel-explicit-stop` for the real cancellation path.
7. [x] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
- Subtask 1 complete: reread the Task 6 plan plus `server/src/ws/types.ts`, `server/src/ws/server.ts`, `server/src/ws/registry.ts`, `server/src/test/features/chat_cancellation.feature`, and `server/src/test/steps/chat_cancellation.steps.ts`. Confirmed the current contract already treats `unsubscribe_conversation` as registry-only and `cancel_inflight` as the only stop path, with existing unit coverage already exercising duplicate stop and noop `cancel_ack` edges that the new Cucumber scenarios should mirror rather than redesign.
- Subtasks 2-5 complete: expanded `server/src/test/features/chat_cancellation.feature` into four focused scenarios covering unsubscribe navigation-only, explicit stop with `inflightId`, late/noop cancel after completion, and conversation-only cancel without `inflightId`. `server/src/test/steps/chat_cancellation.steps.ts` now reuses a shared start-and-subscribe helper plus targeted steps for normal completion, late noop cancel, and conversation-only stop without adding a new websocket test harness.
- Subtask 6 complete: kept Task 6 server-only. The implementation changes stayed inside the websocket server, Cucumber feature/steps, and `design.md`; no Chat page or other client interaction code changed here.
- Subtasks 7-9 complete: documented the final unsubscribe-versus-cancel sequence in `design.md`, recorded the confirmed server contract here for later Chat tasks, and added `DEV-0000046:T6:unsubscribe-navigation-only` plus `DEV-0000046:T6:cancel-explicit-stop` in `server/src/ws/server.ts`. The unsubscribe marker logs only request/subscription context so manual proof can show there was no stop side effect, while the cancel marker records the explicit stop path (`inflight_target`, `conversation_only_inflight`, `conversation_only_agent_run`, or `conversation_only_pending_run`).
- Subtask 10 complete: `npm run lint --workspaces` still reports the repo's existing import-order warning baseline, now 39 warnings after fixing the Task 6-local warning in `server/src/test/steps/chat_cancellation.steps.ts`. `npm run format:check --workspaces` initially failed on that same step file, then passed after formatting it with Prettier.
- Testing step 1 complete: `npm run build:summary:server` passed cleanly with `warning_count: 0`; wrapper log path `logs/test-summaries/build-server-latest.log`.
- Testing step 2 complete: `npm run test:summary:server:unit` passed cleanly with `tests run: 1161`, `passed: 1161`, `failed: 0`; wrapper log path `test-results/server-unit-tests-2026-03-13T20-10-17-910Z.log`.
- Testing step 3 complete: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 71`, `passed: 71`, `failed: 0`; wrapper log path `test-results/server-cucumber-tests-2026-03-13T20-19-54-010Z.log`.
- Testing step 4 complete: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`; wrapper log path `logs/test-summaries/compose-build-latest.log`.
- Testing step 5 complete: `npm run compose:up` brought the rebuilt Task 6 stack up successfully, ending with `codeinfo2-server-1 Healthy` and `codeinfo2-client-1 Started`.
- Testing step 6 complete: manual Playwright validation at `http://host.docker.internal:5001/chat` finished with an empty browser error console. The explicit Stop proof used conversation `stkvynk0h3q` and inflight `bvpcmcfrlet`; `docker exec codeinfo2-server-1 ... rg ... /app/logs/server.1.log` confirmed `DEV-0000046:T6:cancel-explicit-stop` with `stopPath: inflight_target`. The unsubscribe-style proof used sidebar selection from `gfd1yrnney7` to `r05ypqphfmj`; server logs confirmed `DEV-0000046:T6:unsubscribe-navigation-only` with only subscription context (`subscribedConversationCount: 0`) and no stop-side-effect fields. Current Chat still emits the older client `cancel_inflight` noop on sidebar selection, which is the expected downstream Task 7 behavior gap rather than a Task 6 server-contract blocker.
- Testing step 7 complete: `npm run compose:down` stopped and removed the Task 6 containers cleanly, ending with `Network codeinfo2_internal Removed`.

---

### 7. Client - Conversation Sidebar Selection Becomes Pure Navigation

- Task Status: `__done__`
- Git Commits: `d9151d2e`

#### Overview

This task handles only the Chat sidebar selection path. The goal is to make selecting another conversation behave like navigation: no implicit `cancel_inflight`, no stop state leaking into the newly selected view, and no change to the explicit Stop button contract. Keep this task focused on sidebar selection only, not New conversation or provider/model changes.

#### Documentation Locations

- React docs: `https://react.dev/learn/preserving-and-resetting-state` — use this because the task is changing visible conversation selection into local UI navigation rather than external cleanup.
- MUI MCP docs for `@mui/material` `6.4.12` (nearest available docs to the repo's `^6.4.1` dependency): `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, `https://llms.mui.com/material-ui/6.4.12/components/selects.md`, `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, and `https://llms.mui.com/material-ui/6.4.12/api/select.md` — use these because `ChatPage.tsx` already uses MUI `TextField` with `select`, `SelectProps`, `slotProps.select`, and standard Select disabled/onChange behavior rather than a custom control.
- Context7 MCP documentation for Jest's official docs library, with explicit fallback page `https://jestjs.io/docs/getting-started` — use this for Jest-specific matcher, mock, and spy patterns because the client regression file in this task runs under Jest in this repo.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for navigation-flow diagram syntax because this task changes the documented conversation-selection flow in `design.md`.
- React Testing Library docs: `https://testing-library.com/docs/react-testing-library/intro/` — use this for interaction-driven page regression tests that verify visible conversation state.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`, `client/src/test/chatPage.provider.conversationSelection.test.tsx`, and `client/src/test/agentsPage.conversationSelection.test.tsx`, then reread Story `0000046` `### Acceptance Criteria` lines about sidebar selection and `## Research Findings` items 2-4 before editing. Use these docs while reading: React state reset guidance `https://react.dev/learn/preserving-and-resetting-state`, the MUI `TextField`/`Select` docs `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, `https://llms.mui.com/material-ui/6.4.12/components/selects.md`, `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, `https://llms.mui.com/material-ui/6.4.12/api/select.md`, and React Testing Library `https://testing-library.com/docs/react-testing-library/intro/`.
2. [x] Update the existing `handleSelectConversation(...)` path in `client/src/pages/ChatPage.tsx` so choosing another conversation reuses the current `setConversation(...)` local reset flow from `client/src/hooks/useChatStream.ts` and no longer sends `cancelInflight(...)` through `client/src/hooks/useChatWs.ts`, matching Story `0000046` `### Acceptance Criteria`. The exact click-path anchor is `onSelect={handleSelectConversation}` in the current `ConversationList` wiring. Keep this as an event-handler change inside that existing click path; React guidance distinguishes user-triggered navigation/reset work from render-driven Effects, so do not move conversation switching into a new `useEffect(...)`, a new conversation-sync hook, or a new websocket message for this story.
3. [x] Preserve the existing local view reset and rehydration behavior already provided by `setConversation(...)` and the current conversation-loading flow in `client/src/pages/ChatPage.tsx` so the newly selected conversation shows its own transcript and does not inherit sending or stopping UI state from the hidden conversation, as required by Story `0000046` `### Description`.
4. [x] Add a client page regression test in `client/src/test/chatPage.provider.conversationSelection.test.tsx` that selects another conversation during an active run and asserts no `cancel_inflight` websocket message is sent. Purpose: prove sidebar selection is now pure navigation rather than an implicit stop.
5. [x] Add a client page regression test in `client/src/test/chatPage.provider.conversationSelection.test.tsx` that selects another conversation during an active run and asserts the newly visible conversation shows only its own transcript and UI state. Purpose: prove selection does not leak sending or stopping state from the hidden conversation.
6. [x] Update `design.md` with the final sidebar-selection flow for this task and add or adjust the relevant Mermaid diagram so it shows conversation selection as local navigation rather than implicit cancellation. Purpose: keep the documented chat interaction flow aligned with the implemented behavior.
7. [x] Update Story `0000046` task notes with the exact Chat sidebar call site changed in `client/src/pages/ChatPage.tsx`, the matching `design.md` update, and any local UI-state reset rule clarified during implementation so the later Chat tasks can reuse the same wording.
8. [x] Add one product-owned client-side verification log line in the existing sidebar-selection path, using the exact prefix `DEV-0000046:T7:sidebar-selection-navigation`, so it records the previous and next conversation ids plus `cancelSent: false` when Chat switches visible conversations without stopping the hidden run. Purpose: give the manual Playwright validation step one concrete browser-console event to confirm sidebar selection stayed navigation-only.
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client Chat navigation behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`: verify sidebar selection switches the visible conversation without implicitly stopping the hidden run, confirm the newly visible conversation shows only its own transcript/state, confirm the browser debug console has no logged errors, confirm the console contains `DEV-0000046:T7:sidebar-selection-navigation` with `cancelSent: false` and the expected previous/next conversation ids, and take at least one screenshot that clearly shows the visible conversation state after navigation. Save the screenshot under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using the story/task number in the filename, and have the agent review that screenshot to confirm the GUI matches this task’s expected post-navigation state.
6. [x] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
- Subtask 1 complete: reread the Task 7 plan plus the current Chat sidebar, stream, websocket, and nearby Agents/Chat regression files, and verified the existing MUI `TextField select` usage against the Material UI docs. Confirmed the current bug is still the direct `cancelInflight(...)` call inside `handleSelectConversation(...)`, while `setConversation(...)` already provides the local reset/rehydration path this task should reuse without adding a new effect or websocket abstraction.
- Subtasks 2-5 complete: removed the sidebar-only `cancelInflight(...)` call from `handleSelectConversation(...)` in `client/src/pages/ChatPage.tsx`, kept the existing `resetTurns()` + `setConversation(..., { clearMessages: true })` reset path, and added focused client regressions in `client/src/test/chatPage.provider.conversationSelection.test.tsx` for “no `cancel_inflight` on active-run selection” and “selected conversation shows only its own transcript/state.”
- Subtasks 6-7 complete: documented the final sidebar-selection flow in `design.md` and recorded the exact Task 7 rule here for later tasks: `handleSelectConversation(...)` now logs the navigation marker, updates visible provider/model to the selected conversation, and reuses `resetTurns()` + `setConversation(..., { clearMessages: true })` without sending `cancelInflight(...)`.
- Subtask 8 complete: added the exact client verification marker `DEV-0000046:T7:sidebar-selection-navigation` in `client/src/pages/ChatPage.tsx` with previous/next conversation ids and `cancelSent: false`, so the manual proof can confirm the sidebar path stayed navigation-only.
- Subtask 9 complete: `npm run lint --workspaces` still reports the repo's existing 39-warning import-order baseline and did not introduce a Task 7-local warning. `npm run format:check --workspaces` initially failed on `client/src/test/chatPage.provider.conversationSelection.test.tsx`, then passed after formatting that file with Prettier.
- Testing step 1 complete: `npm run build:summary:client` passed cleanly with `warning_count: 0`; wrapper log path `logs/test-summaries/build-client-latest.log`.
- Testing step 2 complete: `npm run test:summary:client` passed cleanly with `tests run: 525`, `passed: 525`, `failed: 0`; wrapper log path `test-results/client-tests-2026-03-13T20-48-52-431Z.log`.
- Testing step 3 complete: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`; wrapper log path `logs/test-summaries/compose-build-latest.log`.
- Testing step 4 complete: `npm run compose:up` brought the Task 7 stack up successfully, ending with `codeinfo2-server-1 Healthy` and `codeinfo2-client-1 Started`.
- Testing step 5 complete: manual Playwright validation at `http://host.docker.internal:5001/chat` passed with an empty browser error console. The active run started in conversation `oh6l1h467x8` and was switched to visible conversation `stkvynk0h3q`; browser console output included `DEV-0000046:T7:sidebar-selection-navigation` with `previousConversationId: oh6l1h467x8`, `nextConversationId: stkvynk0h3q`, and `cancelSent: false`. Server logs confirmed the hidden run was not implicitly stopped: `chat.ws.unsubscribe_conversation` / `DEV-0000046:T6:unsubscribe-navigation-only` were emitted for `oh6l1h467x8`, there was no `cancel_inflight` entry for that conversation, and the hidden run later produced `chat.stream.delta` plus `chat.stream.final` with status `ok`. Screenshot evidence was saved to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000046-task7-sidebar-selection-navigation.png` and reviewed to confirm the selected sidebar row plus clean visible composer/send state after navigation.
- Testing step 6 complete: `npm run compose:down` stopped and removed the Task 7 containers cleanly, ending with `Network codeinfo2_internal Removed`.

---

### 8. Client - New Conversation Becomes a Local Draft Reset, Not a Stop Action

- Task Status: `__done__`
- Git Commits: `eb7484e8`

#### Overview

This task isolates the `New conversation` control. The required output is a clean new draft view with normal composer/send readiness while the old conversation keeps running in the background unless the user explicitly presses Stop. This task should not change provider/model switching; it is only about the New conversation control.

#### Documentation Locations

- React docs: `https://react.dev/learn/preserving-and-resetting-state` — use this because `New conversation` is a local draft reset, not an external stop action.
- Context7 MCP documentation for Jest's official docs library, with explicit fallback page `https://jestjs.io/docs/getting-started` — use this for Jest-specific matcher, mock, and spy patterns because the client regression files in this task run under Jest in this repo.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for draft-reset flow diagram syntax because this task changes the documented `New conversation` flow in `design.md`.
- React Testing Library docs: `https://testing-library.com/docs/react-testing-library/intro/` — use this for the page-level interaction tests proving no cancel message is sent.
- MUI MCP docs for `@mui/material` `6.4.12`: `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, and `https://llms.mui.com/material-ui/6.4.12/api/select.md` — use these because the Chat composer and selectors already rely on existing MUI `TextField` and `Select` control behavior, including disabled and labeled-select handling.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, `client/src/test/chatPage.newConversation.test.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, and `client/src/test/chatPage.stop.test.tsx`, then reread Story `0000046` `### Description` and `### Acceptance Criteria` lines about `New conversation` before editing. Use these docs while reading: React reset guidance `https://react.dev/learn/preserving-and-resetting-state`, React Testing Library `https://testing-library.com/docs/react-testing-library/intro/`, and the current MUI `TextField`/`Select` docs `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, and `https://llms.mui.com/material-ui/6.4.12/api/select.md`.
2. [x] Update the existing `handleNewConversation(...)` path in `client/src/pages/ChatPage.tsx` so it reuses the current `reset()` / `setConversation(...)` flow from `client/src/hooks/useChatStream.ts` and no longer sends `cancelInflight(...)` when another conversation is active, matching Story `0000046` `### Acceptance Criteria`. The exact anchor is the current New conversation button `onClick={() => handleNewConversation()}` in `ChatPage.tsx`. Keep this inside the existing button event path rather than moving it into a new `useEffect(...)`; React guidance treats this as interaction-driven reset logic, not render-driven synchronization. Do not introduce a second draft-reset implementation for this story.
3. [x] Preserve the local reset behavior already provided by the existing draft and transcript hooks so the new conversation opens with an empty transcript placeholder, a cleared input, and normal composer/send readiness for the next user message, as required by Story `0000046` `### Description`.
4. [x] Add a client page regression test in `client/src/test/chatPage.newConversation.test.tsx` that clicks `New conversation` during an active run and asserts no `cancel_inflight` websocket message is sent. Purpose: prove the control no longer acts like an implicit Stop button.
5. [x] Add a client page regression test in `client/src/test/chatPage.newConversation.test.tsx` that clicks `New conversation` during an active run and asserts the previous conversation can keep running server-side. Purpose: prove the old run remains alive in the background until the user explicitly stops it.
6. [x] Add a client page regression test in `client/src/test/chatPage.newConversation.test.tsx` that clicks `New conversation` and asserts the new draft opens with an interactive composer and clean local state. Purpose: prove the local reset happy path still works for the new draft view.
7. [x] Add or update a client page regression test in `client/src/test/chatPage.stop.test.tsx` only if the `handleNewConversation(...)` refactor touches shared stop logic, and assert the explicit Stop button still sends the stop path correctly. Purpose: prove this task does not regress the explicit cancellation contract.
8. [x] Update `design.md` with the final `New conversation` flow for this task and add or adjust the relevant Mermaid diagram so it shows draft reset without cancelling the older run. Purpose: keep the documented chat flow aligned with the implemented background-run behavior.
9. [x] Update Story `0000046` task notes with the exact local draft reset rules implemented for `New conversation`, including the `client/src/pages/ChatPage.tsx` function name, the `client/src/hooks/useChatStream.ts` helper reused, and the matching `design.md` update.
10. [x] Add one product-owned client-side verification log line in the existing New conversation path, using the exact prefix `DEV-0000046:T8:new-conversation-local-reset`, so it records whether an older conversation remained inflight plus `cancelSent: false` when the clean draft view opens. Purpose: give the manual Playwright validation step one concrete browser-console event to confirm the action stayed a local reset.
11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client Chat new-conversation/reset behavior. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`: verify `New conversation` opens a clean draft without cancelling the older run, confirm the composer remains interactive, confirm explicit Stop still behaves correctly when used, confirm the browser debug console has no logged errors, confirm the console contains `DEV-0000046:T8:new-conversation-local-reset` with `cancelSent: false` and a flag showing the older conversation remained inflight when applicable, and take at least one screenshot that clearly shows the clean draft view and interactive composer state. Save the screenshot under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using the story/task number in the filename, and have the agent review that screenshot to confirm the GUI matches this task’s expected reset state.
6. [x] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
- Subtask 1 complete: reread the Task 8 plan plus `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatStream.ts`, `client/src/test/chatPage.newConversation.test.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, and `client/src/test/chatPage.stop.test.tsx`. Confirmed the current bug is isolated to `handleNewConversation(...)`, which still sends `cancelInflight(...)` before reusing the existing `reset()` / `setConversation(...)` draft-reset path that Tasks 7-9 are intended to keep event-handler-based.
- Subtasks 2-3 complete: `client/src/pages/ChatPage.tsx` now keeps `New conversation` inside the existing event-handler reset path but only preserves the old cancel behavior for the provider-change branch, so the button opens a clean draft without sending `cancelInflight(...)`. The reused `resetTurns()` plus `reset()` / `setConversation(..., { clearMessages: true })` path still clears transcript state, input text, and visible stop state for the new draft.
- Subtasks 4-6 complete: rewrote `client/src/test/chatPage.newConversation.test.tsx` around the existing websocket harness and added three focused regressions covering no `cancel_inflight`, background-run continuity, and the clean interactive draft reset. The background-run proof intentionally stays narrow by showing the old conversation can still receive later server events while the new draft remains clean.
- Subtask 7 complete: no `client/src/test/chatPage.stop.test.tsx` change was needed because Task 8 did not touch the explicit Stop handler or shared stop acknowledgement logic. The Stop regression proof remains covered by the existing file and the full client wrapper run for this task.
- Subtasks 8-10 complete: documented the final Task 8 flow in `design.md` with a dedicated Mermaid sequence diagram, and the Task 8 browser marker now comes from `handleNewConversation(...)` in `client/src/pages/ChatPage.tsx`. The log records `previousConversationId`, `nextConversationId`, `olderConversationRemainedInflight`, and `cancelSent: false` so manual proof can distinguish a true local reset from an implicit stop.
- Subtask 11 complete: `npm run lint --workspaces` still reports the repo's existing 39-warning import-order baseline outside Task 8, while `npm run format:check --workspaces` passed cleanly. No Task 8-local lint or formatting fixes were required after the test rewrite and `ChatPage.tsx` update.
- Testing step 1 complete: `npm run build:summary:client` passed cleanly with `warning_count: 0`; wrapper log path `logs/test-summaries/build-client-latest.log`.
- Testing step 2 complete: `npm run test:summary:client` passed cleanly with `tests run: 527`, `passed: 527`, `failed: 0`; wrapper log path `test-results/client-tests-2026-03-13T21-08-59-147Z.log`.
- Testing step 3 complete: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`; wrapper log path `logs/test-summaries/compose-build-latest.log`.
- Testing step 4 complete: `npm run compose:up` brought the rebuilt Task 8 stack up successfully, ending with `codeinfo2-server-1 Healthy` and `codeinfo2-client-1 Started`.
- Testing step 5 complete: manual Playwright validation at `http://host.docker.internal:5001/chat` finished with an empty browser error console. The main Task 8 proof logged `DEV-0000046:T8:new-conversation-local-reset` twice in the browser/server client-log stream; the cleanest run showed `previousConversationId: 0gomji6r6pch`, `nextConversationId: tqdbteqf1ld`, `olderConversationRemainedInflight: true`, and `cancelSent: false`, while server logs showed `chat.ws.unsubscribe_conversation` / `DEV-0000046:T6:unsubscribe-navigation-only` instead of `cancel_inflight` and the hidden run later completed with `chat.stream.final` status `ok`. Explicit Stop was rechecked on conversation `tqdbteqf1ld`, and server logs still showed `DEV-0000046:T6:cancel-explicit-stop` with `stopPath: inflight_target`. Screenshot saved and reviewed at `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000046-task8-new-conversation-local-reset.png`.
- Testing step 6 complete: `npm run compose:down` stopped and removed the Task 8 containers cleanly, ending with `Network codeinfo2_internal Removed`.

---

### 9. Client - Provider Changes Apply Only to the Next Send

- Task Status: `__done__`
- Git Commits: `99d9ab9a`

#### Overview

This task isolates provider switching during an active run. The selected provider should change only for the next message the user sends, while the already-running request continues with the provider it started with. Keep this task focused on the provider-change path only.

#### Documentation Locations

- React docs: `https://react.dev/learn/preserving-and-resetting-state` — use this for deciding when provider selection is local next-send state instead of persisted hidden-run state.
- React docs: `https://react.dev/learn/synchronizing-with-effects` — use this because the risky behavior here comes from state being overwritten by `selectedConversation` sync effects.
- MUI MCP docs for `@mui/material` `6.4.12` (nearest available docs to the repo's `^6.4.1` dependency): `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, `https://llms.mui.com/material-ui/6.4.12/components/selects.md`, `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, and `https://llms.mui.com/material-ui/6.4.12/api/select.md` — use these because the existing provider control is an MUI `TextField select`, and this task needs the documented `select`, `SelectProps`, `slotProps.select`, and `disabled` behavior instead of a control rewrite.
- Context7 MCP documentation for Jest's official docs library, with explicit fallback page `https://jestjs.io/docs/getting-started` — use this for Jest-specific matcher, mock, and spy patterns because the client regression files in this task run under Jest in this repo.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for provider-switch flow diagram syntax because this task changes the documented next-send provider flow in `design.md`.
- React Testing Library docs: `https://testing-library.com/docs/react-testing-library/intro/` — use this for provider-selection regression tests that assert next-send behavior.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [x] Read `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatModel.ts`, `client/src/hooks/useConversationTurns.ts`, `server/src/routes/conversations.ts`, `client/src/test/chatPage.provider.conversationSelection.test.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, and `client/src/test/chatPage.codexDefaults.test.tsx`, then reread Story `0000046` `## Research Findings` items 4-7 and `## Contracts And Storage Shapes` items 2-3 before editing. Use these docs while reading: React preserving/resetting state `https://react.dev/learn/preserving-and-resetting-state`, React synchronizing with effects `https://react.dev/learn/synchronizing-with-effects`, MUI `TextField`/`Select` docs `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, `https://llms.mui.com/material-ui/6.4.12/components/selects.md`, `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, `https://llms.mui.com/material-ui/6.4.12/api/select.md`, and React Testing Library `https://testing-library.com/docs/react-testing-library/intro/`.
2. [x] Update the provider-change path in `client/src/pages/ChatPage.tsx` so an active run is not cancelled when the user changes provider. The concrete code anchors to inspect first are `handleProviderChange(...)`, the `TextField` with `id="chat-provider-select"`, and its `onChange={handleProviderChange}` wiring, because that is the full current path that routes through `handleNewConversation(...)`. The final behavior must match Story `0000046` `### Acceptance Criteria` by changing only the next-send provider. Keep this work in the existing provider `onChange` / event-handler path instead of moving provider switching into a new effect-driven reset flow.
3. [x] Update the current ChatPage provider synchronization rules in `client/src/pages/ChatPage.tsx` so an intentional next-send provider choice is not immediately overwritten by the existing `selectedConversation` provider sync effect, as called out in Story `0000046` `## Research Findings` item 5. The exact code path to inspect first is the `useEffect(...)` that currently calls `setProvider(selectedConversation.provider)` whenever the selected conversation changes; use the currently visible conversation's inflight snapshot from `client/src/hooks/useConversationTurns.ts` to decide when that sync should stop overwriting next-send state, rather than adding a second provider cache.
4. [x] Reuse the existing page-level `provider` state from `client/src/hooks/useChatModel.ts` as the next-send provider source if it can represent the required behavior cleanly; do not add a separate "draft provider" state object unless the existing state proves insufficient during implementation. This simplification is intentional and is part of Story `0000046`'s reuse-first rule.
5. [x] Update the current `providerLocked` logic in `client/src/pages/ChatPage.tsx` on the existing MUI `TextField select` control so next-send provider behavior is actually reachable in the UI, without replacing the control, adding a new server endpoint, adding a new response field, or adding a new conversation storage property. Repository research already showed the current lock is tied to `selectedConversation || messages.length > 0`, so the new rule must be anchored to visible-conversation state that still lets a user choose the next-send provider while an older request remains in flight.
6. [x] Preserve the existing Codex-defaults behavior in `client/src/pages/ChatPage.tsx` when switching into `provider === 'codex'` by reusing `applyCodexDefaults(...)` and `pendingCodexDefaultsReasonRef` for next-send state only; do not reset or mutate the hidden in-flight run’s persisted provider/model/flag state while doing this.
7. [x] Ensure the newly selected provider affects only the next send and does not mutate the provider already associated with the in-flight request, the persisted conversation metadata, or the existing `/conversations/:id/turns` hydration contract from `server/src/routes/conversations.ts` used when the user revisits a hidden run. Start with the provider-change handler and the existing provider sync effect first. Only change the eager provider sync inside conversation selection if the regression tests prove it is still overwriting next-send behavior incorrectly, because leaving the current selection-time sync in place is the lower-risk option.
8. [x] Add a client page regression test in `client/src/test/chatPage.provider.conversationSelection.test.tsx` that changes provider during an active run and asserts no `cancel_inflight` websocket message is sent. Purpose: prove provider changes are local next-send state, not implicit cancellation.
9. [x] Add a client page regression test in `client/src/test/chatPage.provider.conversationSelection.test.tsx` that keeps an older conversation running in the background, opens the visible next-send view, and asserts the provider selector remains enabled and interactive there. Purpose: prove the `providerLocked` change is user-reachable rather than only updating internal state.
10. [x] Add a client page regression test in `client/src/test/chatPage.inflightNavigate.test.tsx` that changes provider during an active run, sends the next prompt, and asserts the new prompt uses the newly selected provider while the hidden run keeps its original persisted provider. Purpose: prove provider changes apply only to the next send.
11. [x] Add a client page regression test in `client/src/test/chatPage.codexDefaults.test.tsx` that switches into `provider === 'codex'` during an active run and asserts the existing next-send Codex defaults still apply. Purpose: prove the provider-change refactor preserves Codex-specific defaults behavior.
12. [x] Add a client page regression test in `client/src/test/chatPage.inflightNavigate.test.tsx` that revisits the older hidden conversation after a provider change and asserts it still shows its own persisted provider state rather than the newer next-send selection. Purpose: prove hidden-run provider metadata is not mutated by draft-state changes.
13. [x] Update `design.md` with the final provider-switch flow for this task and add or adjust the relevant Mermaid diagram so it shows provider changes affecting only the next send while hidden runs preserve their original provider. Purpose: keep the documented chat-state architecture aligned with the implemented provider behavior.
14. [x] Update Story `0000046` task notes with the exact provider persistence and synchronization rule implemented, including the `handleProviderChange(...)` call site, the `selectedConversation` sync effect, the final `providerLocked` behavior, the preserved Codex-defaults behavior in `client/src/pages/ChatPage.tsx`, and the matching `design.md` update.
15. [x] Add one product-owned client-side verification log line in the existing provider-change path, using the exact prefix `DEV-0000046:T9:provider-next-send-updated`, so it records previous provider, next provider, the active conversation id, and `cancelSent: false` when the next-send provider changes during an active hidden run. Purpose: give the manual Playwright validation step one concrete browser-console event to confirm provider switching stayed next-send-only.
16. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [x] `npm run build:summary:client` - Use because this task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [x] `npm run test:summary:client` - Use because this task changes client provider-selection behavior and nearby Jest coverage. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [x] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [x] `npm run compose:up`
5. [x] Manual Playwright-MCP check at `http://host.docker.internal:5001`: verify provider changes do not implicitly stop the hidden run, verify the provider selector remains usable for the next-send view, verify the next prompt uses the newly chosen provider, confirm the browser debug console has no logged errors, confirm the console contains `DEV-0000046:T9:provider-next-send-updated` with the expected previous/next provider values and `cancelSent: false`, and take at least one screenshot that clearly shows the provider selector state and next-send view after the change. Save the screenshot under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using the story/task number in the filename, and have the agent review that screenshot to confirm the GUI matches this task’s expected provider-selection state.
6. [x] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
- Subtask 1 complete: reread the Task 9 plan plus the current Chat provider/model hook, conversation-turn snapshot hook, turns route contract, and the nearby provider/inflight/Codex regression files. Confirmed the remaining behavior gap is concentrated in `handleProviderChange(...)`, the `selectedConversation` provider sync effect, and the `providerLocked` gate in `client/src/pages/ChatPage.tsx`, while `/conversations/:id/turns` must stay the source of persisted provider metadata when a hidden run is revisited.
- Subtasks 2-7 complete: `client/src/pages/ChatPage.tsx` now keeps provider changes inside the existing event-handler path, reuses the Task 8 draft reset without sending `cancelInflight(...)`, and logs `DEV-0000046:T9:provider-next-send-updated` with `cancelSent: false`. The page still uses the existing `provider` state from `useChatModel`, but the visible-conversation provider sync now keys off selected-conversation context plus the current inflight snapshot instead of rerunning on every provider-state change, which stops the old conversation metadata from immediately overwriting an intentional next-send provider choice. `providerLocked` no longer blocks the selector just because a conversation/transcript is visible, and Codex provider switches still reuse `applyCodexDefaults(...)` / `pendingCodexDefaultsReasonRef` for the next-send draft only.
- Subtasks 8-12 complete: added focused client regressions in `client/src/test/chatPage.provider.conversationSelection.test.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, and `client/src/test/chatPage.codexDefaults.test.tsx` covering no implicit `cancel_inflight`, reachable provider selection in the next-send view, next-send provider persistence on the new prompt, preserved hidden-conversation provider metadata on revisit, and preserved Codex defaults during an active-run provider change.
- Subtasks 13-15 complete: documented the final next-send provider flow and Mermaid sequence in `design.md`, and recorded the final Task 9 rule here for later tasks: `handleProviderChange(...)` now resets to a new visible draft, updates the page-level provider for the next send, preserves hidden-run persisted provider/model metadata, and relies on the selected-conversation provider sync only when the visible conversation context changes.
- Subtask 16 complete: `npm run lint --workspaces` finished at the repo's existing 39-warning import-order baseline with no Task 9-local additions, and `npm run format:check --workspaces` initially failed on `client/src/pages/ChatPage.tsx` plus `client/src/test/chatPage.inflightNavigate.test.tsx` before passing cleanly after running Prettier on the touched files.
- Testing step 1 complete: `npm run build:summary:client` passed cleanly with `warning_count: 0`; wrapper log path `logs/test-summaries/build-client-latest.log`.
- Testing step 2 complete: `npm run test:summary:client` passed cleanly with `tests run: 532`, `passed: 532`, `failed: 0`; wrapper log path `test-results/client-tests-2026-03-13T21-38-49-980Z.log`.
- Testing step 3 complete: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`; wrapper log path `logs/test-summaries/compose-build-latest.log`.
- Testing step 4 complete: `npm run compose:up` brought the Task 9 stack up successfully, ending with `codeinfo2-server-1 Healthy` and `codeinfo2-client-1 Started`.
- Testing step 5 complete: manual Playwright validation at `http://host.docker.internal:5001/chat` passed with an empty browser error console. The provider-change proof started a Codex run in hidden conversation `79wij0dzyq7`, switched the visible next-send draft to provider `lmstudio`, and logged `DEV-0000046:T9:provider-next-send-updated` with `previousProvider: codex`, `nextProvider: lmstudio`, `activeConversationId: 79wij0dzyq7`, and `cancelSent: false`. Server logs confirmed the hidden run was navigated away from rather than cancelled (`chat.ws.unsubscribe_conversation` plus `DEV-0000046:T6:unsubscribe-navigation-only` for `79wij0dzyq7` with no `cancel_inflight` for that conversation), and the next send started a new LM Studio run in `ynsuswe2u8a` with `requestedProvider` / `executionProvider` both `lmstudio` and model `qwen3.5-vl-122b-a10b-mlx-crack`. Screenshot evidence was saved and reviewed at `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/0000046-task9-provider-next-send.png`, confirming the visible next-send view showed the LM Studio provider and its model while the hidden Codex conversation remained listed separately.
- Testing step 6 complete: `npm run compose:down` stopped and removed the Task 9 containers cleanly, ending with `Network codeinfo2_internal Removed`.

---

### 10. Client - Model Changes Apply Only to the Next Send

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task isolates model switching during an active run. The selected model should change only for the next message the user sends, while the already-running request continues with the model it started with. Keep this task focused on the model-change path only.

#### Documentation Locations

- React docs: `https://react.dev/learn/preserving-and-resetting-state` — use this for deciding when model selection is local next-send state instead of persisted hidden-run state.
- React docs: `https://react.dev/learn/synchronizing-with-effects` — use this because the risky behavior here comes from the current `selectedConversation` model sync effect.
- MUI MCP docs for `@mui/material` `6.4.12` (nearest available docs to the repo's `^6.4.1` dependency): `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, `https://llms.mui.com/material-ui/6.4.12/components/selects.md`, `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, and `https://llms.mui.com/material-ui/6.4.12/api/select.md` — use these because the existing model control is an MUI `TextField select`, and this task needs the documented `select`, `SelectProps`, and disabled/onChange behavior rather than a replacement component.
- Context7 MCP documentation for Jest's official docs library, with explicit fallback page `https://jestjs.io/docs/getting-started` — use this for Jest-specific matcher, mock, and spy patterns because the client regression files in this task run under Jest in this repo.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for model-switch flow diagram syntax because this task changes the documented next-send model flow in `design.md`.
- React Testing Library docs: `https://testing-library.com/docs/react-testing-library/intro/` — use this for model-selection regression tests that assert next-send behavior.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [ ] Read `client/src/pages/ChatPage.tsx`, `client/src/hooks/useChatModel.ts`, `client/src/hooks/useConversationTurns.ts`, `server/src/routes/conversations.ts`, `client/src/test/chatPage.models.test.tsx`, `client/src/test/chatPage.provider.conversationSelection.test.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, `client/src/test/chatPage.codexDefaults.test.tsx`, and `client/src/test/chatPage.flags.reasoning.payload.test.tsx`, then reread Story `0000046` `## Research Findings` items 4-7 and `## Contracts And Storage Shapes` items 2-3 before editing. Use these docs while reading: React preserving/resetting state `https://react.dev/learn/preserving-and-resetting-state`, React synchronizing with effects `https://react.dev/learn/synchronizing-with-effects`, MUI `TextField`/`Select` docs `https://llms.mui.com/material-ui/6.4.12/components/text-fields.md`, `https://llms.mui.com/material-ui/6.4.12/components/selects.md`, `https://llms.mui.com/material-ui/6.4.12/api/text-field.md`, `https://llms.mui.com/material-ui/6.4.12/api/select.md`, and React Testing Library `https://testing-library.com/docs/react-testing-library/intro/`.
2. [ ] Update the model-change path in `client/src/pages/ChatPage.tsx` so an active run is not cancelled or mutated when the user changes model. The concrete code anchors to inspect first are the `TextField` with `id="chat-model-select"`, its current `onChange={(event) => setSelected(event.target.value)}` path, and the `selectedConversation` model sync effect that currently calls `setSelected(...)`; the final behavior must match Story `0000046` `### Acceptance Criteria` by changing only the next-send model. Keep this work in the existing model selector event path instead of moving model switching into a new effect-driven reset flow.
3. [ ] Update the current ChatPage model synchronization rules in `client/src/pages/ChatPage.tsx` so an intentional next-send model choice is not immediately overwritten by the existing `selectedConversation` model sync effect, as called out in Story `0000046` `## Research Findings` item 5. Use the currently visible conversation's inflight snapshot from `client/src/hooks/useConversationTurns.ts` to decide when that sync should stop overwriting next-send state, rather than adding a second model cache or a new persistence field.
4. [ ] Reuse the existing page-level selected-model state from `client/src/hooks/useChatModel.ts` as the next-send model source if it can represent the required behavior cleanly; do not add a separate "draft model" state object unless the existing state proves insufficient during implementation. This simplification is intentional and is part of Story `0000046`'s reuse-first rule.
5. [ ] Preserve the existing capability-driven Codex reasoning behavior in `client/src/pages/ChatPage.tsx` when the next-send model changes by keeping `selectedModelCapabilities`, `modelReasoningEffort`, `codexCapabilityStateKeyRef`, and `codexDynamicReasoningStateKeyRef` aligned with the newly selected next-send model, while not mutating the hidden in-flight run’s persisted model/flag state.
6. [ ] Ensure the newly selected model affects only the next send and does not mutate the model already associated with the in-flight request, the persisted conversation metadata, or the existing `/conversations/:id/turns` hydration contract from `server/src/routes/conversations.ts` used when the user revisits a hidden run. Start with the model selector path and the existing model sync effect first. Only change the eager `setSelected(...)` synchronization during conversation selection if the regression tests prove it is still overwriting next-send behavior incorrectly, because leaving the current selection-time sync in place is the lower-risk option.
7. [ ] Add a client page regression test in `client/src/test/chatPage.models.test.tsx` that changes model during an active run and asserts no `cancel_inflight` websocket message is sent. Purpose: prove the model-change path satisfies the same explicit-stop-only contract as provider changes and sidebar navigation.
8. [ ] Add a client page regression test in `client/src/test/chatPage.models.test.tsx` that changes model during an active run, sends the next prompt, and asserts the new prompt uses the newly selected model while the hidden run keeps its original persisted model. Purpose: prove model changes apply only to the next send.
9. [ ] Add a client page regression test in `client/src/test/chatPage.flags.reasoning.payload.test.tsx` that changes the next-send model and asserts capability-driven reasoning payload behavior follows that newly selected model. Purpose: prove model-linked reasoning flags still track the draft model correctly.
10. [ ] Add a client page regression test in `client/src/test/chatPage.codexDefaults.test.tsx` that changes model within the Codex-capable path and asserts the existing Codex reasoning/default behavior is preserved. Purpose: prove the model-change refactor does not break Codex-specific defaults.
11. [ ] Add a client page regression test in `client/src/test/chatPage.inflightNavigate.test.tsx` that revisits the older hidden conversation after a model change and asserts it still shows its own persisted model state rather than the newer next-send selection. Purpose: prove hidden-run model metadata is not mutated by draft-state changes.
12. [ ] Update `design.md` with the final model-switch flow for this task and add or adjust the relevant Mermaid diagram so it shows model changes affecting only the next send while hidden runs preserve their original model and reasoning state. Purpose: keep the documented chat-state architecture aligned with the implemented model behavior.
13. [ ] Update Story `0000046` task notes with the exact model persistence and synchronization rule implemented, including the `selectedConversation` model sync effect, the `setSelected(...)` call site, the preserved Codex reasoning-capability behavior, the next-send-only behavior in `client/src/pages/ChatPage.tsx`, and the matching `design.md` update.
14. [ ] Add one product-owned client-side verification log line in the existing model-change path, using the exact prefix `DEV-0000046:T10:model-next-send-updated`, so it records previous model, next model, the active conversation id, and `cancelSent: false` when the next-send model changes during an active hidden run. Purpose: give the manual Playwright validation step one concrete browser-console event to confirm model switching stayed next-send-only.
15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because this task changes client model-selection behavior and nearby Jest coverage. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001`: verify model changes do not implicitly stop the hidden run, verify the next prompt uses the newly chosen model, verify model-specific reasoning/default behavior remains correct, confirm the browser debug console has no logged errors, confirm the console contains `DEV-0000046:T10:model-next-send-updated` with the expected previous/next model values and `cancelSent: false`, and take at least one screenshot that clearly shows the model selector state and the visible next-send view after the change. Save the screenshot under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using the story/task number in the filename, and have the agent review that screenshot to confirm the GUI matches this task’s expected model-selection state.
6. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 11. Client - Prevent Hidden-Run Late Events From Corrupting The Visible Conversation

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task locks down the first hidden-run failure mode that appears after Tasks 7-10 remove implicit cancellation: a background conversation can still finish later, but its late websocket events must not leak banners, assistant content, or stopping state into whichever conversation is currently visible. This task is only about visible-state isolation from late events. It is not the task that proves revisiting a hidden conversation later still rehydrates correctly; that proof is split into the next task so each task stays smaller and independently testable.

#### Documentation Locations

- React docs: `https://react.dev/learn/preserving-and-resetting-state` — use this for visible-conversation isolation and local reset behavior.
- React docs: `https://react.dev/learn/synchronizing-with-effects` — use this for the late-event/effect-cleanup side of hidden-run state handling.
- Context7 MCP documentation for Jest's official docs library, with explicit fallback page `https://jestjs.io/docs/getting-started` — use this for Jest-specific matcher, mock, and spy patterns because the client regression files in this task run under Jest in this repo.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for hidden-run event-flow diagram syntax because this task changes the documented late-event isolation flow in `design.md`.
- React Testing Library docs: `https://testing-library.com/docs/react-testing-library/intro/` — use this for visible-state isolation tests around late websocket events.
- `ws` repository documentation: `https://github.com/websockets/ws/blob/master/README.md` — use this for server message ordering/subscription semantics relevant to hidden runs.
- MDN WebSocket reference: `https://developer.mozilla.org/en-US/docs/Web/API/WebSocket` — use this for general message and subscription behavior when describing hidden-run events.
- Cucumber guide: `https://cucumber.io/docs/guides/testable-architecture/` — use this only if existing server feature coverage truly needs a small extension after the client and turns tests are updated.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [ ] Read `client/src/hooks/useChatStream.ts`, `client/src/hooks/useChatWs.ts`, `client/src/pages/ChatPage.tsx`, `client/src/test/useChatStream.inflightMismatch.test.tsx`, `client/src/test/chatPage.inflightNavigate.test.tsx`, and the existing chat cancellation feature files, then reread Story `0000046` `## Research Findings` items 3-4 and `## Edge Cases and Failure Modes` items 10-12 before editing. Use these docs while reading: React preserving/resetting state `https://react.dev/learn/preserving-and-resetting-state`, React synchronizing with effects `https://react.dev/learn/synchronizing-with-effects`, `ws` README `https://github.com/websockets/ws/blob/master/README.md`, MDN WebSocket `https://developer.mozilla.org/en-US/docs/Web/API/WebSocket`, and React Testing Library `https://testing-library.com/docs/react-testing-library/intro/`.
2. [ ] Adjust local Chat state handling only if needed in `client/src/hooks/useChatStream.ts` and `client/src/pages/ChatPage.tsx` so the visible conversation or new draft clears inherited sending/stopping indicators when another conversation is still running in the background, matching Story `0000046` `### Acceptance Criteria` lines about not leaking hidden-run UI state. The exact hook anchors to inspect first are the existing conversation-mismatch, inflight-mismatch, and `turn_final` late-event paths in `useChatStream.ts`. Prefer fixing this inside those existing state guards first, and only touch `client/src/pages/ChatPage.tsx` if the hook-level fix is not enough. Keep the existing client transport split intact: `client/src/hooks/useChatWs.ts` already uses the browser `WebSocket` API while `server/src/ws/server.ts` already uses `ws` with `WebSocketServer({ noServer: true })`, so do not add a second websocket abstraction while fixing this state leak.
3. [ ] Reuse the existing conversation-mismatch and inflight-mismatch guards already present in `client/src/hooks/useChatStream.ts` as the primary late-event isolation mechanism; do not add a new hidden-conversation client cache, a second websocket message filter, or a new page-level event queue for this story.
4. [ ] Add a client hook regression test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that delivers a stale `assistant_delta` for a hidden conversation and asserts the visible conversation transcript does not change. Purpose: prove streamed assistant text is ignored when the conversation does not match.
5. [ ] Add a client hook regression test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that delivers a stale `tool_event` for a hidden conversation and asserts the visible conversation does not render that tool output. Purpose: prove tool-side late events are isolated the same way as assistant text.
6. [ ] Add a client hook regression test in `client/src/test/useChatStream.inflightMismatch.test.tsx` that delivers a stale `turn_final` for a hidden conversation and asserts no stop banner or stopped state leaks into the visible conversation. Purpose: prove final-status events do not corrupt the current view.
7. [ ] Add a client hook or page regression test in `client/src/test/useChatStream.inflightMismatch.test.tsx` or `client/src/test/chatPage.inflightNavigate.test.tsx` that delivers a `cancel_ack` event with `result: 'noop'` outside an explicit stop attempt and asserts the visible conversation state does not change. Purpose: prove navigation/reset flows do not depend on `cancel_ack` cleanup and that noop acknowledgements do not leak stop UI into the wrong thread.
8. [ ] Add a client page regression test in `client/src/test/chatPage.inflightNavigate.test.tsx` that applies a stale inflight snapshot or mismatch refresh event from a hidden conversation and asserts the visible conversation state does not change. Purpose: prove snapshot-style late events are isolated alongside stream events.
9. [ ] Keep this task focused on late-event isolation only. Do not add `/conversations/:id/turns` rehydration changes, a new active-run endpoint, or new snapshot merge behavior here; that work belongs to the next task so the proof paths stay small and clear.
10. [ ] Update `design.md` with the final hidden-run late-event isolation flow for this task and add or adjust the relevant Mermaid diagram so it shows stale websocket events being ignored for the visible conversation. Purpose: keep the documented background-run event flow aligned with the implemented client behavior.
11. [ ] Update Story `0000046` task notes with any additional conversation-isolation rule or websocket mismatch case discovered while implementing this task, including the exact hooks/tests changed and the matching `design.md` update so later documentation work does not need to rediscover them.
12. [ ] Add one product-owned client-side verification log line in the existing late-event ignore path, using the exact prefix `DEV-0000046:T11:hidden-run-event-ignored`, so it records event type, hidden conversation id, visible conversation id, and the reason the event was ignored. Purpose: give the manual Playwright validation step one concrete browser-console event to confirm hidden-run late events were isolated instead of rendered.
13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:client` - Use because this task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
2. [ ] `npm run test:summary:client` - Use because this task changes client hidden-run event handling and nearby Jest coverage. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
3. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
4. [ ] `npm run compose:up`
5. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001`: verify late events from a hidden conversation do not corrupt the visible conversation, verify no leaked stopping/completed UI appears in the wrong thread, confirm the browser debug console has no logged errors, confirm the console contains `DEV-0000046:T11:hidden-run-event-ignored` with the expected hidden/visible conversation ids and ignored event type, and take at least one screenshot that clearly shows the visible conversation stayed unchanged after the hidden-run event. Save the screenshot under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using the story/task number in the filename, and have the agent review that screenshot to confirm the GUI matches this task’s expected event-isolation state.
6. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 12. Client - Reuse Existing Hidden-Run Rehydration When Revisiting Conversations

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task locks down the second hidden-run failure mode: after a conversation keeps running in the background, revisiting it later must reuse the existing turns snapshot and inflight rehydration path so the user sees the right transcript and any still-active inflight state. This task is only about rehydration and snapshot proof. It must not re-open the late-event isolation work from Task 11 unless a snapshot change truly requires it.

#### Documentation Locations

- React docs: `https://react.dev/learn/preserving-and-resetting-state` — use this for how visible state should be reset and then rehydrated when returning to a conversation.
- React docs: `https://react.dev/learn/synchronizing-with-effects` — use this for the existing fetch/rehydration effect model rather than inventing a second synchronization path.
- Context7 MCP documentation for Jest's official docs library, with explicit fallback page `https://jestjs.io/docs/getting-started` — use this for Jest-specific matcher, mock, and spy patterns because the client regression files in this task run under Jest in this repo.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for rehydration-flow diagram syntax because this task changes the documented hidden-run revisit flow in `design.md`.
- React Testing Library docs: `https://testing-library.com/docs/react-testing-library/intro/` — use this for snapshot-rehydration page regressions.
- MDN WebSocket reference: `https://developer.mozilla.org/en-US/docs/Web/API/WebSocket` — use this only for general message timing expectations around revisiting a still-running conversation.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [ ] Read `client/src/hooks/useConversationTurns.ts`, `client/src/pages/ChatPage.tsx`, `server/src/routes/conversations.ts`, `server/src/test/integration/conversations.turns.test.ts`, `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx`, and `client/src/test/useConversationTurns.refresh.test.ts`, then reread Story `0000046` `## Research Findings` item 4 and `## Contracts And Storage Shapes` items 2-3 before editing. Use these docs while reading: React preserving/resetting state `https://react.dev/learn/preserving-and-resetting-state`, React synchronizing with effects `https://react.dev/learn/synchronizing-with-effects`, MDN WebSocket `https://developer.mozilla.org/en-US/docs/Web/API/WebSocket`, and React Testing Library `https://testing-library.com/docs/react-testing-library/intro/`.
2. [ ] Reuse the existing `/conversations/:id/turns` inflight snapshot from `server/src/routes/conversations.ts` and the `useConversationTurns.ts` hydration path when proving that a hidden run can be revisited later; do not add a new active-run endpoint, a new response flag, or a new hidden-conversation client cache for this story. The exact anchors to inspect first are the current optional `inflight` payload returned by the turns route and the `fetchSnapshot(...)` path in `useConversationTurns.ts` that merges that payload into client state.
3. [ ] Adjust client snapshot merge or server turns-snapshot logic only if needed so revisiting a hidden conversation shows its own persisted transcript plus its current inflight snapshot again, without mutating the visible draft or another conversation's state. Prefer keeping the server route contract unchanged and solving this in the existing client snapshot merge path first; only touch `server/src/routes/conversations.ts` if the current payload shape truly cannot express the required rehydration behavior.
4. [ ] Add a client page regression test in `client/src/test/chatPage.inflightSnapshotRefreshMerge.test.tsx` that revisits a still-running hidden conversation and asserts its own transcript plus inflight snapshot reappear correctly. Purpose: prove the main hidden-run rehydration happy path works through the existing snapshot merge flow.
5. [ ] Add a client hook/page regression test in `client/src/test/useConversationTurns.refresh.test.ts` that revisits a conversation with no inflight snapshot and asserts only persisted transcript data is shown with no leaked running-state UI. Purpose: prove the completed/idle rehydration path stays clean.
6. [ ] Add a server integration test in `server/src/test/integration/conversations.turns.test.ts` that calls `GET /conversations/:id/turns` for a still-running conversation and asserts the existing `inflight` snapshot payload is present. Purpose: lock down the server route shape the client rehydration happy path depends on.
7. [ ] Add a server integration test in `server/src/test/integration/conversations.turns.test.ts` that calls `GET /conversations/:id/turns` for a completed or idle conversation and asserts no `inflight` payload is returned. Purpose: lock down the no-inflight route shape the clean rehydration path depends on.
8. [ ] Keep this task rehydration-focused: do not add new websocket message types, new browser caches, or extra server feature files as part of this proof path.
9. [ ] Update `design.md` with the final hidden-run rehydration flow for this task and add or adjust the relevant Mermaid diagram so it shows `/conversations/:id/turns` inflight snapshot reuse for running versus completed conversations. Purpose: keep the documented snapshot/rehydration architecture aligned with the implemented behavior.
10. [ ] Update Story `0000046` task notes with the exact rehydration rule confirmed by `server/src/routes/conversations.ts`, `client/src/hooks/useConversationTurns.ts`, the snapshot tests, and `design.md` so later documentation work can quote one final rule.
11. [ ] Add one product-owned client-side verification log line in the existing hidden-run rehydration path, using the exact prefix `DEV-0000046:T12:hidden-run-rehydrated`, so it records conversation id, whether an inflight snapshot was present, and whether the visible draft state was replaced by persisted transcript plus snapshot data. Purpose: give the manual Playwright validation step one concrete browser-console event to confirm rehydration succeeded through the intended path.
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:server` - Use because this task may touch the server turns route contract. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use because this task changes client rehydration behavior. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Use because server/common turns-snapshot behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:client` - Use because client/common rehydration behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
5. [ ] `npm run compose:build:summary` - Use because this task is testable from the front end. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
6. [ ] `npm run compose:up`
7. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001`: revisit a hidden running conversation and confirm transcript plus inflight state rehydrate correctly, revisit a completed conversation and confirm no stale running-state UI remains, confirm the browser debug console has no logged errors, confirm the console contains `DEV-0000046:T12:hidden-run-rehydrated` with the expected conversation id plus `hasInflightSnapshot: true` or `false` depending on the scenario, and take screenshots for both the running and completed revisit states. Save the screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using the story/task number in the filenames, and have the agent review those screenshots to confirm the GUI matches this task’s expected rehydration states.
8. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 13. Final Task - Update Shared Documentation

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task is documentation-only. It updates the shared written material after implementation is complete so the repository docs describe the final ingest and Chat behavior accurately. Keep this task focused on README/design/structure/story documentation only, not on pull-request notes or the full validation suite.

#### Documentation Locations

- GitHub Markdown docs: `https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax` — use this for README and repository-markdown formatting conventions.
- Context7 MCP documentation for Mermaid's official docs library, with explicit fallback page `https://mermaid.js.org/intro/` — use this for Mermaid syntax validation whenever this task updates or redraws architecture and flow diagrams in `design.md`.
- Mermaid docs: `https://mermaid.js.org/intro/` — use this for any diagram text or flow updates in `design.md`.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [ ] Review and update `README.md` at the repository root so it documents any user-visible behavior change or operator-facing command change introduced by this story, especially the blank-embedding-input failure rule and the Chat rule that navigation is not cancellation from Story `0000046` `### Description`. Purpose: keep the primary reader/operator documentation aligned with the implemented product behavior.
2. [ ] Review and update `design.md` at the repository root so it describes the final shared-boundary rules for blank embeddable text and “navigation is not cancellation,” including any Mermaid diagram or flow text that would otherwise be misleading when compared to Story `0000046` `## Research Findings`. Purpose: keep the architecture and flow documentation aligned with the implemented system behavior.
3. [ ] Review and update `projectStructure.md` at the repository root so it lists any added, removed, or repurposed files touched by this story, using the file paths recorded in the earlier task implementation notes so a reader can find the changed code quickly. Purpose: keep the file-layout documentation aligned with the final implementation footprint.
4. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: this task is documentation-only, so do not attempt to run raw build/test commands here. Rely on the wrapper-based validation in the implementation tasks and the full regression coverage in Task 15.

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 14. Final Task - Prepare PR Notes

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This task is summary-only. It turns the completed implementation notes into one PR-ready summary while the exact behavior is still fresh. Keep this task focused on the final change summary and evidence references, not on editing shared product docs or running the full validation suite.

#### Documentation Locations

- GitHub Markdown docs: `https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax` — use this for the final summary formatting conventions.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [ ] Review the finished implementation notes from Tasks 1-13 and Story `0000046` `### Acceptance Criteria` so the summary reflects only completed, verified behavior. Use GitHub Markdown formatting guidance `https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax` so the final PR-ready summary reads like a normal repository summary rather than raw task notes.
2. [ ] Create a pull-request-ready summary covering the ingest boundary fix, the defensive provider guards, the Chat navigation/reset behavior change, the reused contracts, and the added regression coverage, using the exact task notes recorded in Story `0000046` so the summary does not omit a completed behavior.
3. [ ] Include the key proof points in that summary: which existing contracts were reused, which tests were extended instead of added as new harnesses, and which acceptance criteria were validated by targeted versus full-suite runs.
4. [ ] Update Story `0000046` task notes with the location of the final PR-ready summary or the exact wording source used, so later release-note work can reuse it without re-reading every task.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: this task is summary-only, so do not attempt to run raw build/test commands here. Rely on the wrapper-based validation in the implementation tasks and the full regression coverage in Task 15.

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.

---

### 15. Final Task - Run Full Validation for Story Completion

- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

This final task proves the story end to end against the acceptance criteria. It must run the full wrapper-based builds and tests, confirm the product still behaves correctly in Docker, and capture the final manual verification evidence after the implementation and documentation tasks are complete.

#### Documentation Locations

- Docker Compose docs: `https://docs.docker.com/compose/` — use this for the build/up/down validation flow and container lifecycle checks.
- Playwright docs: `https://playwright.dev/docs/intro` — use this for the manual/browser verification workflow and screenshot capture expectations.
- Context7 MCP documentation for Jest's official docs library, with explicit fallback page `https://jestjs.io/docs/getting-started` — use this for interpreting Jest-specific failure output because the full client wrapper in this task runs the Jest suite used by the repo.
- Jest docs: `https://jestjs.io/docs/getting-started` — use this for full client test-suite expectations when interpreting wrapper output.
- Cucumber guide: `https://cucumber.io/docs/guides/10-minute-tutorial/` — use this for full server feature-suite expectations and terminology when validating the cucumber wrapper output.

#### Subtasks

Isolation rule for this task: a junior may be assigned only one numbered subtask below. Treat this task's `Overview`, `Documentation Locations`, and any Story `0000046` section references named inside that numbered subtask as mandatory input for that one subtask, even when the wording duplicates information from elsewhere in the story.

1. [ ] Review every acceptance criterion in Story `0000046` and confirm each earlier task changed the right files and added the right regression coverage before running the full validation suite; use the finished task notes plus Story `0000046` `### Acceptance Criteria` as the audit checklist. Use Docker Compose docs `https://docs.docker.com/compose/`, Playwright docs `https://playwright.dev/docs/intro`, Jest docs `https://jestjs.io/docs/getting-started`, and the Cucumber guide `https://cucumber.io/docs/guides/10-minute-tutorial/` while preparing to interpret the wrapper outputs and the final manual verification flow.
2. [ ] Run the full wrapper-based build, test, and e2e commands from the Story `0000046` Testing section after all code and documentation work is complete, and compare failures back to the task/file paths already recorded in the story if anything breaks.
3. [ ] Use the Playwright MCP/browser tooling to manually verify the two core behaviors documented in Story `0000046` `### Acceptance Criteria`: the ingest blank-input failure path and the Chat navigation/no-implicit-cancel behavior. Save screenshots under `test-results/screenshots/` using the story index and task number in each filename so the evidence is easy to trace back later.
4. [ ] Record any final validation notes or residual risks back into Story `0000046`, including the wrapper command used and the acceptance criterion it validates, so the completion state is auditable even if a later reader only opens the final task notes.
5. [ ] During final validation, check and record the task-specific verification evidence from Tasks 1-12 where applicable so the story notes show exactly which runtime signals were seen. Task 3 is the server-wrapper baseline repair task and does not introduce a new product verification log. Tasks 2 and 4 are backend-only guards whose `DEV-0000046:T2:openai-blank-input-guard-hit` and `DEV-0000046:T4:lmstudio-blank-input-guard-hit` proofs come from their targeted server-wrapper evidence rather than browser-generated flows. The expected GUI/runtime signals exercised during final manual regression are therefore `DEV-0000046:T1:blank-chunks-filtered`, `DEV-0000046:T5:fresh-ingest-zero-embeddable`, `DEV-0000046:T6:unsubscribe-navigation-only`, `DEV-0000046:T6:cancel-explicit-stop`, `DEV-0000046:T7:sidebar-selection-navigation`, `DEV-0000046:T8:new-conversation-local-reset`, `DEV-0000046:T9:provider-next-send-updated`, `DEV-0000046:T10:model-next-send-updated`, `DEV-0000046:T11:hidden-run-event-ignored`, and `DEV-0000046:T12:hidden-run-rehydrated`, while the targeted server-test evidence for Tasks 2 and 4 must also be referenced in the final notes. Purpose: make the final regression pass auditable against the exact runtime events this story introduced without requiring impossible browser-generated T2/T4 logs.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only rule: do not attempt to build or test this task with raw commands. Use only the summary wrappers below. Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous counts.

1. [ ] `npm run build:summary:server` - Mandatory because final regression checks must cover server/common code touched by this story. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Mandatory because final regression checks must cover client/common code touched by this story. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Mandatory because final regression checks must cover server node:test unit/integration behavior touched by this story. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Mandatory because final regression checks must cover server feature/step behavior touched by this story. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Mandatory because final regression checks must cover client/common behavior touched by this story. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [ ] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [ ] `npm run compose:up`
9. [ ] Manual Playwright-MCP check at `http://host.docker.internal:5001`: verify the ingest blank-input failure path, verify Chat sidebar selection/New conversation/provider/model changes do not implicitly cancel a hidden run, verify revisiting hidden conversations rehydrates correctly, verify general regression coverage around Stop still works, confirm the browser debug console has no logged errors, confirm the expected task-specific verification log lines from Tasks 1 and 4-12 appear with the outcomes described in those tasks when their flows are exercised, and separately reference Task 2’s targeted server-test proof instead of expecting a browser-generated `DEV-0000046:T2:openai-blank-input-guard-hit` event. Save all screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using the story/task number in each filename, and have the agent review those screenshots as part of the final acceptance check to confirm the GUI matches the story’s expected states.
10. [ ] `npm run compose:down`

#### Implementation notes

- Add implementation notes here after each completed subtask and testing step.
