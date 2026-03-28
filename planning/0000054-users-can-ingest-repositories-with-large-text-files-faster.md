# Story 0000054 – Users can ingest repositories with large text files faster

## Implementation Plan

This section describes how to work this story from planning through implementation. Use the latest `planning/plan_format.md` as the source of truth for workflow details; do not copy this file as a template for new stories.
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria, and Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
Use the Questions section actively during planning: capture open questions early, and as answers are discovered, remove the resolved questions and incorporate the information into the relevant sections. The Questions section must be empty before creating tasks (for example via the tasking workflow) or using any `/improve-plan` / plan-refinement commands.

### Description

Repository ingest already works, but users notice a sharp slowdown when a repository contains one or more very large text files. In practice this is especially visible with large Markdown planning documents, where chunking can dominate the whole run before embeddings even start. The current ingest path is accurate, but it is not optimized for this kind of prose-heavy input.

The slowdown comes from a combination of factors. Discovery accepts Markdown and other text files into the normal ingest path. The chunker is primarily tuned for code-like boundaries, so a very large Markdown file can fall through to a more expensive fallback path that repeatedly token-counts large substrings while trying to cut them down to fit. The ingest job then waits for that chunking work to finish before it can begin embedding those chunks. This makes large planning documents feel especially slow and makes the run appear stuck on a single file for a long time.

The embedding stage also leaves performance on the table today. Embeddings are effectively sent one chunk at a time from the ingest loop even when the provider could accept multiple inputs per request or process multiple requests concurrently. OpenAI can batch multiple inputs in one request subject to its existing input and token guardrails. LM Studio can process multiple embedding requests at the same time. The user wants the runtime to take advantage of those capabilities, but in a controlled way that is configurable per provider.

This story therefore introduces three tightly related ingest optimizations:

- a large-text chunking path for Markdown and other prose-oriented text files;
- provider-aware embedding dispatch that can batch and/or run multiple embedding requests concurrently;
- a narrower AST rebuild trigger during re-embed so that non-AST-only changes do not force AST work.

The large-text chunking path should stay conservative. It should use file type plus file size to decide when a file should take the prose-oriented splitter path instead of the current general path. That prose path should prefer Markdown and paragraph boundaries such as headings, blank lines, fenced blocks, and list breaks. It should still respect token limits, but it should avoid repeatedly re-tokenizing the entire remaining tail of a huge document whenever possible.

The embedding dispatcher should remain provider-aware and bounded. OpenAI batching must still obey the existing per-input and per-request token guardrails. LM Studio concurrency must still be capped so that the runtime does not accidentally flood the provider. The user wants provider-specific environment variables that set the maximum number of in-flight embedding requests. Conservative defaults should preserve current behavior until operators choose to raise them.

The user has now fixed the provider-control contract more precisely. Each provider should have its own batching setting and its own max-in-flight-requests setting. The runtime should apply provider-specific hard caps when it reads those values, so a value that is too large is silently clamped to what that provider actually supports instead of failing the run or emitting a warning just because the configured number was high. For example, LM Studio should continue to behave as batch size `1` even if its configured batching value is higher, while OpenAI can use larger batches when its own guardrails still allow them. These environment variables should be present in the checked-in `.env` file with sensible defaults and short explanations of how each one affects dispatch.

The initial defaults are also now fixed. OpenAI should start with batch size `20` and max in-flight requests `10`. LM Studio should start with batch size `1` and max in-flight requests `4`. OpenAI batching must still stay inside the provider's official request limits, including the current maximum input-array size and total-token limit for a single embeddings request. The dispatcher should also be slot-driven rather than wave-driven: if a provider is already at its max in-flight count and one request finishes, the next eligible embedding work should be sent immediately instead of waiting for the rest of that in-flight group to finish first.

The queue contract is now also fixed. The waiting chunk queue should still be sized from max-in-flight behavior rather than becoming a fully manual tuning surface, but the server should expose one absolute queue-cap environment variable in `server/.env` so operators can protect memory when needed. That variable should default to `-1`, which means "do not apply an extra absolute cap beyond the normal queue logic." A value of `0` means "do not allow a waiting queue at all," and any positive value caps the queue at that many waiting items even if the derived queue logic would otherwise allow more.

The AST optimization should also stay conservative. The user does not want partial AST updates that only recalculate the changed source file. Instead, the rule should be:

- if no AST-supported file was added, changed, or deleted, skip AST rebuild during delta re-embed;
- if any AST-supported file was added, changed, or deleted, rebuild the full AST exactly as the current full-rebuild path already does.

For this story, a file move should stay as delete-plus-add rather than introducing a separate rename detector. That means an AST-supported move is treated as AST-relevant because it produces an AST-supported delete and add, which still triggers the existing full AST rebuild.

That means the story is intentionally about doing less wasted work when only non-AST files changed, not about making AST indexing partially incremental for changed source files.

Overall, when the story is complete, users should be able to ingest repositories with large planning documents or other prose-heavy text files much faster, while preserving the existing correctness guarantees around token limits, provider behavior, AST consistency, cancellation, and persisted ingest outputs.

### Acceptance Criteria

- Discovery keeps file size metadata so the ingest pipeline can distinguish normal text files from very large text files without performing an extra filesystem read later.
- Large Markdown, MDX, and plain-text files can take a dedicated prose-oriented chunking path selected by file type plus a configurable size threshold.
- The large-text chunking path prefers prose and Markdown boundaries such as headings, blank lines, fenced code blocks, and list breaks before falling back to smaller cuts.
- The large-text chunking path still respects the active model token budget and does not emit chunks that violate existing embedding input limits.
- The large-text chunking path avoids repeatedly re-tokenizing the whole remaining tail of a very large document whenever a local backoff or boundary-based cut can be used instead.
- The ingest job no longer needs to finish chunking an entire huge text file before it can begin dispatching embeddings for that file.
- The embedding pipeline supports provider-aware dispatch with bounded concurrency rather than only one serial embedding call per chunk.
- OpenAI embedding dispatch can submit multi-input requests while still honoring the existing OpenAI guardrails for per-input size, total token count, and input count per request.
- LM Studio embedding dispatch can process multiple embedding requests concurrently up to a configured provider-specific limit.
- Provider-specific environment variables control the maximum number of in-flight embedding requests, with conservative defaults that preserve current behavior unless explicitly changed.
- Provider-specific environment variables also control batching where the provider supports it, with conservative defaults present in the checked-in `.env` file and brief documentation explaining how they work.
- Effective provider settings are clamped to provider-supported limits without failing the run or emitting a warning solely because a configured value was too large.
- LM Studio's effective batch size remains `1` even if its configured batching value is higher.
- The checked-in `.env` file documents initial provider defaults of OpenAI batch size `20`, OpenAI max in-flight `10`, LM Studio batch size `1`, and LM Studio max in-flight `4`.
- OpenAI's effective batching continues to obey the provider's official single-request embedding limits even when the configured batch size is larger.
- The embedding dispatcher applies backpressure or another bounded-queue strategy so a very large file does not simply move the bottleneck into unbounded in-memory chunk accumulation.
- The embedding dispatcher refills provider capacity immediately when any in-flight embedding request completes, rather than waiting for a whole wave of in-flight requests to finish before dispatching more work.
- The server `.env` file includes an absolute waiting-queue cap setting with default `-1`, where `-1` disables the extra cap, `0` disables the waiting queue, and positive values cap the waiting queue size.
- Chunk order, chunk metadata, and persisted vector metadata remain deterministic even when embedding requests run concurrently.
- Cancellation and failure behavior remain coherent when multiple embedding requests are in flight.
- During delta re-embed, AST rebuild is skipped entirely when the delta contains no AST-supported added, changed, or deleted file.
- During delta re-embed, if the delta contains any AST-supported added, changed, or deleted file, the runtime rebuilds the full AST using the existing full-rebuild behavior rather than a changed-file-only AST update.
- File moves stay as delete-plus-add in this story rather than adding separate rename detection, so an AST-supported move still counts as AST-relevant work.
- Markdown-only or other non-AST-only delta re-embeds no longer trigger a full AST rebuild.
- The story preserves current correctness guarantees for AST data by avoiding partial changed-file-only AST persistence logic.
- Existing ingest outputs, provider selection behavior, and root metadata remain compatible with the current ingest model unless a change is explicitly required for these optimizations.
- Tests and documentation are updated to describe the new large-text chunking path, provider concurrency controls, and the refined AST rebuild trigger.

### Out Of Scope

- Implementing partial AST updates that recalculate only changed AST-supported files.
- Changing the rule that a single changed AST-supported file should trigger a full AST rebuild.
- Changing which file extensions are considered AST-supported.
- Replacing the current AST storage model, AST schema, or AST query model.
- Adding a separate rename-detection system for delta re-embed decisions.
- Broad redesign of the ingest UI beyond what is needed to surface existing progress and preserve correctness.
- Reworking unrelated embedding-provider behavior outside repository ingest.
- Introducing provider auto-tuning, adaptive concurrency learning, or dynamic runtime benchmarking beyond the explicit configuration discussed for this story.
- Rejecting runs or surfacing warnings solely because an operator configured batch or in-flight values above a provider's supported cap.
- Redesigning vector persistence, repository metadata persistence, or Chroma collection layout beyond what is needed to support the new dispatch path safely.
- General-purpose chunking changes for every content type when the specific user pain here is large prose-oriented text documents such as Markdown planning files.
- Parallelizing whole ingest runs across multiple repositories or relaxing the existing ingest busy-state contract.
- Any unrelated performance work in chat, flows, commands, or non-ingest indexing paths.

### Additional Repositories

- No Additional Repositories

### Questions

1. Should one OpenAI batch be allowed to mix chunks from different files, or should batches stay within one file?
   - Why this is important: The story already says OpenAI can batch multiple inputs, but batching across file boundaries changes retry behavior, ordering, and how well small files can share provider capacity.
   - Best Answer: Allow batches to mix chunks from different files, as long as original file and chunk ordering metadata is preserved and persistence stays deterministic. That gives the dispatcher the best chance to keep provider slots full instead of waiting for one file at a time, while still letting the runtime rebuild stable output order after responses return.
   - Where this answer came from: Repo evidence from [server/src/ingest/ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), [server/src/ingest/providers/types.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/types.ts), [server/src/ingest/providers/openaiEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/openaiEmbeddingProvider.ts), and [server/src/ingest/chunker.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/chunker.ts), which show the current serial per-chunk/per-file shape and the need to preserve deterministic metadata; external evidence from OpenAI embeddings docs showing one request can take an array of input strings, plus DeepWiki guidance that batches can safely mix items from different sources when ordering metadata is carried separately. Context7 could not be queried because the workspace quota is exhausted today, and web search evidence included the official OpenAI embeddings API and MDN docs reviewed for this planning round.
2. When cancel is pressed, should new embedding work stop immediately even if a few requests are already finishing?
   - Why this is important: The story already requires coherent cancellation with multiple requests in flight, but we still need one clear rule for what “cancel” means once some provider requests have already been sent.
   - Best Answer: Yes. Stop dispatching any new embedding work immediately, try to abort in-flight requests where the provider/client supports it, and ignore late-arriving results from requests that were already too far along to stop. That is the safest answer because it makes cancel feel immediate without depending on every provider to support perfect mid-flight aborts.
   - Where this answer came from: Repo evidence from [server/src/ingest/ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), [server/src/ingest/providers/openaiEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/openaiEmbeddingProvider.ts), [server/src/ingest/providers/lmstudioEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/lmstudioEmbeddingProvider.ts), and [server/src/routes/ingestCancel.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestCancel.ts), which show current cancellation is run-level and not request-level; external evidence from MDN `AbortController` guidance and DeepWiki queue-cancellation patterns recommending immediate stop of new work plus best-effort cleanup for active work. Context7 could not be queried because the workspace quota is exhausted today.
3. If a file move crosses the AST-supported boundary, should it still count as AST-relevant work?
   - Why this is important: The story already keeps moves as delete-plus-add, but a move from unsupported to supported, or supported to unsupported, still needs one clear AST rule.
   - Best Answer: Yes. If either side of the move is AST-supported, treat the move as AST-relevant and rebuild the full AST. That is the safest answer because a delete-plus-add across the AST boundary changes which files belong in the AST dataset, so the conservative full rebuild rule should still apply.
   - Where this answer came from: Repo evidence from [planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md](/home/d_a_s/code/codeInfo2/planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md), [server/src/ingest/deltaPlan.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/deltaPlan.ts), [server/src/ingest/ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), and [server/src/test/unit/ingest-ast-indexing.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-ast-indexing.test.ts), which show rename detection is not first-class and AST rebuild decisions stay conservative; external evidence from DeepWiki queue/batch guidance was not needed beyond the general conservative-recovery precedent because this is mainly a repository-specific AST correctness rule. Context7 could not be queried because the workspace quota is exhausted today.

## Decisions

1. Provider batching and max-in-flight controls should stay separate for each provider.
   - The question being addressed: Should OpenAI batching get its own setting, or should max in-flight requests be the only tuning knob?
   - Why the question matters: Batching controls how many chunks go into one request, while max in-flight controls how many requests can run at once. Keeping them separate makes provider behavior easier to tune and reason about.
   - What the answer is: Each provider should have its own batching setting and its own max-in-flight-requests setting. The runtime should clamp configured values to provider-supported limits without failing the run or logging just because the configured value was too high. LM Studio therefore keeps effective batch size `1` even if configured higher, while OpenAI can use larger batches within its own guardrails. The checked-in `.env` file should include these defaults with explanations: OpenAI batch size `20`, OpenAI max in-flight `10`, LM Studio batch size `1`, and LM Studio max in-flight `4`. The dispatcher should refill a freed in-flight slot immediately instead of waiting for the rest of a wave to complete.
   - Where the answer came from: User decision in this planning session, supported by repo evidence in [planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md](/home/d_a_s/code/codeInfo2/planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md), [openaiEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/openaiEmbeddingProvider.ts), and [lmstudioEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/lmstudioEmbeddingProvider.ts), plus official OpenAI embeddings docs reviewed through web search, Context7, and DeepWiki.
   - Why it is the best answer: It preserves simple operator control, matches the fact that providers support different request shapes, keeps the dispatcher fully utilized without wave stalls, and avoids turning an over-large config value into an unnecessary run failure.

2. File moves should stay as delete-plus-add in this story.
   - The question being addressed: Should file moves stay as delete-plus-add, or should this story add real rename detection?
   - Why the question matters: The current delta planner only compares file paths and hashes, so rename handling needs a clear rule or implementers may accidentally expand scope.
   - What the answer is: Keep file moves as delete-plus-add in this story, and treat any AST-supported move as AST-relevant because it produces an AST-supported delete and add. That means a move still triggers the existing full AST rebuild path, but the story does not add a separate rename-detection system.
   - Where the answer came from: User decision in this planning session, supported by repo evidence in [deltaPlan.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/deltaPlan.ts), [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), and [planning/0000020-ingest-delta-reembed-and-ingest-page-ux.md](/home/d_a_s/code/codeInfo2/planning/0000020-ingest-delta-reembed-and-ingest-page-ux.md).
   - Why it is the best answer: It keeps the performance story focused, matches the current delta planner, and preserves conservative AST correctness without inventing new rename logic.

3. The waiting chunk queue should stay tied to max-in-flight behavior, with one absolute queue-cap env var for memory protection.
   - The question being addressed: Should the waiting chunk queue get its own setting, or should it stay an internal limit tied to max in-flight requests?
   - Why the question matters: The queue is the in-memory list of chunks waiting to be embedded, so this decision affects both memory growth and how much operator tuning complexity the system exposes.
   - What the answer is: Keep the normal queue behavior tied to max in-flight logic, but add one absolute queue-cap setting in `server/.env` to protect memory when needed. That env var should default to `-1`, meaning no extra absolute cap beyond the normal queue logic. A value of `0` means no waiting queue at all, and any positive value caps the waiting queue at that many items.
   - Where the answer came from: User decision in this planning session, supported by repo evidence in [config.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/config.ts), [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), and [ingest-batch-flush.feature](/home/d_a_s/code/codeInfo2/server/src/test/features/ingest-batch-flush.feature), plus Node stream backpressure guidance previously reviewed through Context7 and DeepWiki.
   - Why it is the best answer: It keeps the default operator surface simple, preserves the performance benefits of queue sizing derived from concurrency, and still gives operators one clear emergency brake for memory-heavy environments.

## Implementation Ideas

- Extend `DiscoveredFile` to include `size` so the chunker can choose a large-text strategy without an extra stat call later.
- Add a prose-oriented chunking strategy in the ingest chunker for large `.md`, `.mdx`, and `.txt` files that splits on headings, blank lines, fenced code blocks, and list boundaries before local fallback cuts.
- Convert chunk production into a streaming or incremental shape so large-file chunking and embedding can overlap instead of forcing a full-file chunking pause up front.
- Introduce an embedding dispatcher that preserves chunk order while supporting provider-aware batching and provider-aware request concurrency.
- Add provider-specific configuration such as `CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE`, `CODEINFO_INGEST_OPENAI_MAX_INFLIGHT`, `CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE`, and `CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT`, documented in the checked-in `.env` file with short explanations of what each setting controls.
- Seed the checked-in `.env` file with the initial agreed defaults and explanations: OpenAI batch size `20`, OpenAI max in-flight `10`, LM Studio batch size `1`, and LM Studio max in-flight `4`.
- Add a server queue-cap env var such as `CODEINFO_INGEST_MAX_QUEUE_SIZE=-1`, documented in `server/.env` so operators know that `-1` disables the extra cap, `0` disables the waiting queue, and positive values cap queue depth.
- Clamp configured provider values to provider-supported limits at runtime, so unsupported high values degrade safely instead of failing the run or emitting a warning for that reason alone.
- Extend the provider model interface so ingest can use a batch-oriented embedding method when available and fall back to bounded concurrent single-item requests otherwise.
- Keep the dispatcher queue bounded so performance gains do not come at the cost of uncontrolled memory growth on very large text files.
- Use slot-based dispatch so each completed in-flight request immediately pulls the next queued embedding work instead of waiting for an entire wave to finish.
- Apply the absolute queue cap after the normal queue-sizing logic so the env value acts as a memory-protection ceiling rather than replacing the default queue behavior.
- Preserve deterministic metadata ordering by carrying original file and chunk indexes through the concurrent dispatch path and reassembling results in that stable order before persistence.
- During delta re-embed, derive a separate `astRelevantDelta` check from the normal delta plan and only enter the AST rebuild path when that filtered delta contains at least one AST-supported add, change, or delete.
- Treat file moves as delete-plus-add rather than adding rename detection, so AST-supported moves naturally fall into the same conservative AST-relevant path.
- Reuse the existing full AST rebuild path when `astRelevantDelta` is non-empty rather than designing a partial AST persistence model in this story.
- Add targeted unit and integration coverage for large Markdown chunking, provider concurrency limits, concurrent result ordering, cancellation with in-flight requests, OpenAI batch guardrails, LM Studio concurrency caps, and the new AST skip/full-rebuild gate.
