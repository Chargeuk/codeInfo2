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

The AST optimization should also stay conservative. The user does not want partial AST updates that only recalculate the changed source file. Instead, the rule should be:

- if no AST-supported file was added, changed, deleted, or effectively renamed, skip AST rebuild during delta re-embed;
- if any AST-supported file was added, changed, deleted, or effectively renamed, rebuild the full AST exactly as the current full-rebuild path already does.

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
- If batching controls are introduced for providers that support them, those controls are also conservative by default and do not violate provider guardrails.
- The embedding dispatcher applies backpressure or another bounded-queue strategy so a very large file does not simply move the bottleneck into unbounded in-memory chunk accumulation.
- Chunk order, chunk metadata, and persisted vector metadata remain deterministic even when embedding requests run concurrently.
- Cancellation and failure behavior remain coherent when multiple embedding requests are in flight.
- During delta re-embed, AST rebuild is skipped entirely when the delta contains no AST-supported added, changed, deleted, or effectively renamed file.
- During delta re-embed, if the delta contains any AST-supported added, changed, deleted, or effectively renamed file, the runtime rebuilds the full AST using the existing full-rebuild behavior rather than a changed-file-only AST update.
- Markdown-only or other non-AST-only delta re-embeds no longer trigger a full AST rebuild.
- The story preserves current correctness guarantees for AST data by avoiding partial changed-file-only AST persistence logic.
- Existing ingest outputs, provider selection behavior, and root metadata remain compatible with the current ingest model unless a change is explicitly required for these optimizations.
- Tests and documentation are updated to describe the new large-text chunking path, provider concurrency controls, and the refined AST rebuild trigger.

### Out Of Scope

- Implementing partial AST updates that recalculate only changed AST-supported files.
- Changing the rule that a single changed AST-supported file should trigger a full AST rebuild.
- Changing which file extensions are considered AST-supported.
- Replacing the current AST storage model, AST schema, or AST query model.
- Broad redesign of the ingest UI beyond what is needed to surface existing progress and preserve correctness.
- Reworking unrelated embedding-provider behavior outside repository ingest.
- Introducing provider auto-tuning, adaptive concurrency learning, or dynamic runtime benchmarking beyond the explicit configuration discussed for this story.
- Redesigning vector persistence, repository metadata persistence, or Chroma collection layout beyond what is needed to support the new dispatch path safely.
- General-purpose chunking changes for every content type when the specific user pain here is large prose-oriented text documents such as Markdown planning files.
- Parallelizing whole ingest runs across multiple repositories or relaxing the existing ingest busy-state contract.
- Any unrelated performance work in chat, flows, commands, or non-ingest indexing paths.

### Additional Repositories

- No Additional Repositories

### Questions

1. Should OpenAI batching get its own setting, or should max in-flight requests be the only tuning knob?
   - Why this is important: Batching and concurrency are different limits, and mixing them together would make provider guardrails harder to reason about.
   - Best Answer: Give OpenAI a separate batch-size setting and keep max in-flight for request concurrency, with both defaulting to `1`. The repo already treats OpenAI and LM Studio differently at the provider layer, OpenAI already supports multi-input embedding requests, and OpenAI's official limits apply both per input and across the full request.
   - Where this answer came from: Repo evidence first: [planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md](/home/d_a_s/code/codeInfo2/planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md), [openaiEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/openaiEmbeddingProvider.ts), and [lmstudioEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/lmstudioEmbeddingProvider.ts). External evidence: OpenAI embeddings API reference, Context7 `/openai/openai-node`, and DeepWiki `openai/openai-node`.

2. Should the waiting chunk queue get its own setting, or should it stay an internal limit tied to max in-flight requests?
   - Why this is important: The queue is the in-memory list of chunks waiting to be embedded, so this decision controls whether large files stay memory-safe without adding too many new operator settings.
   - Best Answer: Keep the queue bound internal and tie it to max in-flight requests with a small fixed multiplier instead of adding another env var. The current repo already uses `flushEvery` for persistence cadence rather than buffering control, and Node's backpressure guidance favors bounded buffers over unbounded producer output.
   - Where this answer came from: Repo evidence first: [planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md](/home/d_a_s/code/codeInfo2/planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md), [config.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/config.ts), [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), and [ingest-batch-flush.feature](/home/d_a_s/code/codeInfo2/server/src/test/features/ingest-batch-flush.feature). External evidence: Node stream docs via Context7 `/nodejs/node`, DeepWiki `nodejs/node`, and the official Node.js stream backpressure guide.

3. Should file moves stay as delete-plus-add, or should this story add real rename detection?
   - Why this is important: The current delta planner only compares file paths and hashes, so "effective rename" needs a clear rule or implementers may accidentally add extra scope.
   - Best Answer: Keep file moves as delete-plus-add in this story, and treat any AST-supported move as AST-relevant so it still triggers the existing full AST rebuild. That matches the current delta planner, keeps AST behavior conservative, and avoids inventing new rename-detection logic inside a performance story.
   - Where this answer came from: Repo evidence first: [planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md](/home/d_a_s/code/codeInfo2/planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md), [deltaPlan.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/deltaPlan.ts), [ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), and [planning/0000020-ingest-delta-reembed-and-ingest-page-ux.md](/home/d_a_s/code/codeInfo2/planning/0000020-ingest-delta-reembed-and-ingest-page-ux.md). External evidence: external SDK and API docs were reviewed, but this recommendation is driven by repo-specific ingest semantics rather than a third-party contract.

## Implementation Ideas

- Extend `DiscoveredFile` to include `size` so the chunker can choose a large-text strategy without an extra stat call later.
- Add a prose-oriented chunking strategy in the ingest chunker for large `.md`, `.mdx`, and `.txt` files that splits on headings, blank lines, fenced code blocks, and list boundaries before local fallback cuts.
- Convert chunk production into a streaming or incremental shape so large-file chunking and embedding can overlap instead of forcing a full-file chunking pause up front.
- Introduce an embedding dispatcher that preserves chunk order while supporting provider-aware batching and provider-aware request concurrency.
- Add provider-specific configuration such as `CODEINFO_INGEST_OPENAI_MAX_INFLIGHT` and `CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT`, with defaults of `1`.
- Consider provider-specific batch-size configuration for providers that support multi-input requests, while keeping current guardrails authoritative.
- Extend the provider model interface so ingest can use a batch-oriented embedding method when available and fall back to bounded concurrent single-item requests otherwise.
- Keep the dispatcher queue bounded so performance gains do not come at the cost of uncontrolled memory growth on very large text files.
- Preserve deterministic metadata ordering by carrying original file and chunk indexes through the concurrent dispatch path and reassembling results in that stable order before persistence.
- During delta re-embed, derive a separate `astRelevantDelta` check from the normal delta plan and only enter the AST rebuild path when that filtered delta contains at least one AST-supported add, change, delete, or effective rename.
- Reuse the existing full AST rebuild path when `astRelevantDelta` is non-empty rather than designing a partial AST persistence model in this story.
- Add targeted unit and integration coverage for large Markdown chunking, provider concurrency limits, concurrent result ordering, cancellation with in-flight requests, OpenAI batch guardrails, LM Studio concurrency caps, and the new AST skip/full-rebuild gate.
