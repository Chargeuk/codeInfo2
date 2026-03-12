# Story 0000046 – Prevent Blank Embedding Inputs And Unintended Conversation Switch Stops

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Two separate user-facing reliability problems have been observed in the current product.

The first problem affects repository ingest when embedding text for vector storage. Users have seen OpenAI embedding requests fail because the system sometimes tries to embed empty strings or strings that contain only whitespace. When that happens, the ingest run can fail even though the repository content itself is otherwise valid. The same ingest work often appears to succeed with LM Studio, which makes the behavior look provider-specific, but that is misleading. The current system is producing invalid embedding inputs before the provider-specific call happens, and OpenAI is simply surfacing the bug more clearly than LM Studio does.

The second problem affects the web chat experience. When a user is in an active conversation and clicks another conversation in the Conversations sidebar, the conversation they were on stops as though the user had pressed the Stop button. That is not the intended product behavior. A conversation should continue running until it finishes naturally or until the user explicitly presses Stop. Merely changing which conversation is visible in the UI should not send a cancellation request to the server.

These problems are related at a product level because both are cases where the system is being too permissive at the wrong boundary:

- ingest accepts invalid text into the embedding pipeline instead of rejecting or filtering it at the shared core boundary;
- chat navigation triggers cancellation at a view-switching boundary even though cancellation should only occur at an explicit user-stop boundary.

From the user point of view, the desired outcomes are:

- ingest should never send empty or whitespace-only text to any embedding provider, regardless of whether the selected provider is OpenAI, LM Studio, or a future provider;
- conversation switching in the web UI should behave like viewing a different thread, not like stopping the previously active thread;
- the explicit Stop button should continue to work exactly as the authoritative cancellation action.

This story is therefore about correctness of shared boundaries:

- the shared ingest boundary that turns file text into embeddable chunks;
- the shared UI/server cancellation boundary that determines when a run should actually be stopped.

### Acceptance Criteria

- Repository ingest never sends empty strings or whitespace-only strings to any embedding provider.
- The fix applies at a shared boundary so it protects all embedding solutions, not only OpenAI.
- Empty files, whitespace-only files, and files with leading blank lines do not produce provider embedding requests for blank text.
- Normal files still preserve their meaningful chunk content and chunk ordering after the fix.
- If a blank embedding input somehow reaches the provider layer after the shared ingest fix, the provider layer rejects it with one clear product-owned error path rather than silently depending on provider-specific behavior.
- OpenAI ingest no longer fails because the product generated blank embedding inputs internally.
- LM Studio ingest behavior remains supported and does not regress.
- Selecting a different conversation from the Conversations sidebar does not send a stop or cancel request for the previously active run.
- The previously active run continues server-side after sidebar selection until it finishes naturally or the user explicitly presses Stop.
- The Stop button continues to send the real cancellation request and continues to drive the existing stopping and stopped UX.
- Switching the visible conversation only clears or rehydrates local view state for the newly selected conversation and does not invent terminal events for the previously active conversation.
- Late websocket events from a still-running non-visible conversation do not corrupt the newly selected conversation view.
- Chat behavior is aligned with the already-accepted Agents behavior where active conversation switching is allowed without forcing cancellation.
- If the product rule is applied consistently beyond sidebar selection, Chat "New conversation" and provider-change flows also stop cancelling runs implicitly and rely on explicit Stop instead.
- Automated coverage is added or updated for the embedding and conversation-switch cases described in this story.

### Out Of Scope

- Redesigning chunking heuristics beyond what is required to prevent blank embedding inputs.
- Changing chunk content for non-blank text just to normalize formatting or whitespace style.
- Replacing the existing ingest architecture or vector store.
- Changing provider authentication, retry policy, or rate-limit behavior beyond what is required to handle blank-input validation cleanly.
- Redesigning the chat, agents, or flows page layout.
- Changing the server-authoritative Stop contract introduced for explicit cancellation flows.
- Introducing multi-tab shared view state for hidden conversations beyond the existing websocket and snapshot behavior.
- Reworking unrelated conversation hydration, transcript rendering, or sidebar styling behavior.

### Questions

-

## Implementation Ideas

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

- Suggested defensive provider fix:
  - Add one shared embedding-input guard used by all provider adapters and embedding-function implementations.
  - The guard should reject empty or whitespace-only text before any network or SDK call is made.
  - This guard should be defensive only; the primary ingest path should already have filtered the bad inputs before the provider layer is reached.
  - The same shared guard can later protect non-ingest embedding call sites if more are added.

- Suggested ingest/file-handling considerations:
  - Decide whether whitespace-only files should remain "discovered but produce zero chunks" or should be treated as non-embeddable earlier in the file-processing path.
  - Keep AST indexing behavior intentionally separate from embeddable-chunk behavior unless implementation proves both should share one text-eligibility rule.
  - Ensure start and re-embed flows both use the same blank-chunk filtering rule.

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
  - If the product rule should be consistent everywhere, also remove implicit cancellation from Chat "New conversation" and provider-change flows.

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
  - If implicit cancellation is removed from Chat "New conversation" and provider change, update the corresponding Chat tests to match the new explicit-stop-only rule.
  - Preserve or extend tests that prove late websocket events from an old conversation do not alter the currently selected conversation view.

- Documentation and rollout notes:
  - Record clearly in the story tasks that the fix is intentionally shared-boundary work, not an OpenAI-only workaround.
  - Record clearly that the desired UX rule is "conversation selection is navigation, Stop is cancellation."
  - When implementation is complete, verify that the story notes explain the relationship to Story 0000043 so future work does not reintroduce sidebar-triggered stop behavior while adjusting stop-state UX.
