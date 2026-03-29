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

The large-text chunking path should stay conservative. It should use file type plus file size to decide when a file should take the prose-oriented splitter path instead of the current general path. That prose path should prefer Markdown and paragraph boundaries such as headings, blank lines, fenced blocks, and list breaks. It should still respect token limits, but it should avoid repeatedly re-tokenizing the entire remaining tail of a huge document whenever possible. The size threshold should follow the repo's existing ingest-config pattern rather than adding a separate route-level knob: use one checked-in env var named `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES`, resolve it through `server/src/ingest/config.ts`, and default it to `65536` bytes so operators can tune it when needed without changing code.

The embedding dispatcher should remain provider-aware and bounded. OpenAI batching must still obey the existing per-input and per-request token guardrails. LM Studio concurrency must still be capped so that the runtime does not accidentally flood the provider. The user wants provider-specific environment variables that set the maximum number of in-flight embedding requests. The checked-in defaults should stay conservative and bounded, but they should reflect the agreed initial dispatch settings for this story rather than pretending the runtime will remain fully serial by default.

The user has now fixed the provider-control contract more precisely. Each provider should have its own batching setting and its own max-in-flight-requests setting. The runtime should apply provider-specific hard caps when it reads those values, so a value that is too large is silently clamped to what that provider actually supports instead of failing the run or emitting a warning just because the configured number was high. For example, LM Studio should continue to behave as batch size `1` even if its configured batching value is higher, while OpenAI can use larger batches when its own guardrails still allow them. These environment variables should be present in the checked-in `.env` file with sensible defaults and short explanations of how each one affects dispatch.

The initial defaults are also now fixed. OpenAI should start with batch size `20` and max in-flight requests `10`. LM Studio should start with batch size `1` and max in-flight requests `4`. OpenAI batching must still stay inside the provider's official request limits, including the current maximum input-array size and total-token limit for a single embeddings request. The dispatcher should also be slot-driven rather than wave-driven: if a provider is already at its max in-flight count and one request finishes, the next eligible embedding work should be sent immediately instead of waiting for the rest of that in-flight group to finish first.

The batching rule is now also more specific. OpenAI batches may mix chunks from different files instead of staying file-local, as long as the runtime preserves original file and chunk ordering metadata and reassembles persisted output deterministically after responses return. This lets the dispatcher keep provider capacity busy even when some files produce only a few chunks.

The queue contract is now also fixed. The waiting chunk queue should still be sized from max-in-flight behavior rather than becoming a fully manual tuning surface, but the server should expose one absolute queue-cap environment variable in `server/.env` so operators can protect memory when needed. That variable should default to `-1`, which means "do not apply an extra absolute cap beyond the normal queue logic." A value of `0` means "do not allow a waiting queue at all," and any positive value caps the queue at that many waiting items even if the derived queue logic would otherwise allow more.

Cancellation behavior is also now more precise. If the user cancels an ingest while multiple embedding requests are in flight, the dispatcher should stop sending any new embedding work immediately. It should try to abort already in-flight provider requests where the provider client supports that behavior, but it should not depend on every provider supporting perfect mid-flight cancellation. Any late-arriving results from requests that were already too far along to stop should be ignored rather than written after cancellation.

The AST optimization should also stay conservative. The user does not want partial AST updates that only recalculate the changed source file. Instead, the rule should be:

- if no AST-supported file was added, changed, or deleted, skip AST rebuild during delta re-embed;
- if any AST-supported file was added, changed, or deleted, rebuild the full AST exactly as the current full-rebuild path already does.

For this story, a file move should stay as delete-plus-add rather than introducing a separate rename detector. That means an AST-supported move is treated as AST-relevant because it produces an AST-supported delete and add, which still triggers the existing full AST rebuild.

That same conservative rule also applies when a move crosses the AST-supported boundary. If either side of the move is AST-supported, treat the move as AST-relevant and rebuild the full AST. This keeps the AST dataset correct even when a file moves into or out of the supported set under a new path.

That means the story is intentionally about doing less wasted work when only non-AST files changed, not about making AST indexing partially incremental for changed source files.

Overall, when the story is complete, users should be able to ingest repositories with large planning documents or other prose-heavy text files much faster, while preserving the existing correctness guarantees around token limits, provider behavior, AST consistency, cancellation, and persisted ingest outputs. Repository evidence also shows this story can stay inside the existing server ingest flow and existing ingest UI: it does not require a new frontend surface, a new server listener, or a separate worker service. Proof for this story should stay practical: deterministic functional coverage plus one reproducible large-file validation scenario are required, but the story does not introduce a mandatory millisecond SLA or percentage-improvement benchmark gate.

### Acceptance Criteria

- Discovery keeps file size metadata so the ingest pipeline can distinguish normal text files from very large text files without performing an extra filesystem read later.
- Large Markdown, MDX, and plain-text files can take a dedicated prose-oriented chunking path selected by file type plus the checked-in `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES` threshold, default `65536`.
- The large-text chunking path prefers prose and Markdown boundaries such as headings, blank lines, fenced code blocks, and list breaks before falling back to smaller cuts.
- The large-text chunking path still respects the active model token budget and does not emit chunks that violate existing embedding input limits.
- The large-text chunking path avoids repeatedly re-tokenizing the whole remaining tail of a very large document whenever a local backoff or boundary-based cut can be used instead.
- The ingest job no longer needs to finish chunking an entire huge text file before it can begin dispatching embeddings for that file.
- The embedding pipeline supports provider-aware dispatch with bounded concurrency rather than only one serial embedding call per chunk.
- OpenAI embedding dispatch can submit multi-input requests while still honoring the existing OpenAI guardrails for per-input size, total token count, and input count per request.
- LM Studio embedding dispatch can process multiple embedding requests concurrently up to a configured provider-specific limit.
- Provider-specific environment variables control the maximum number of in-flight embedding requests, with conservative checked-in defaults that match the agreed initial dispatch behavior for this story.
- Provider-specific environment variables also control batching where the provider supports it, with conservative defaults present in the checked-in `.env` file and brief documentation explaining how they work.
- Effective provider settings are clamped to provider-supported limits without failing the run or emitting a warning solely because a configured value was too large.
- LM Studio's effective batch size remains `1` even if its configured batching value is higher.
- The checked-in `.env` file documents initial provider defaults of OpenAI batch size `20`, OpenAI max in-flight `10`, LM Studio batch size `1`, and LM Studio max in-flight `4`.
- OpenAI's effective batching continues to obey the provider's official single-request embedding limits even when the configured batch size is larger.
- OpenAI batches may contain chunks from different files, as long as persisted metadata and output ordering remain deterministic.
- The embedding dispatcher applies backpressure or another bounded-queue strategy so a very large file does not simply move the bottleneck into unbounded in-memory chunk accumulation.
- The embedding dispatcher refills provider capacity immediately when any in-flight embedding request completes, rather than waiting for a whole wave of in-flight requests to finish before dispatching more work.
- The server `.env` file includes an absolute waiting-queue cap setting with default `-1`, where `-1` disables the extra cap, `0` disables the waiting queue, and positive values cap the waiting queue size.
- The server `.env` file includes `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES=65536` with a short explanation that this is the minimum file size for the prose-oriented large-text path.
- Chunk order, chunk metadata, and persisted vector metadata remain deterministic even when embedding requests run concurrently.
- Cancellation and failure behavior remain coherent when multiple embedding requests are in flight.
- On cancel, the dispatcher stops sending new embedding work immediately, attempts best-effort aborts for in-flight requests where supported, and ignores late results from requests that could not be stopped in time.
- During delta re-embed, AST rebuild is skipped entirely when the delta contains no AST-supported added, changed, or deleted file.
- During delta re-embed, if the delta contains any AST-supported added, changed, or deleted file, the runtime rebuilds the full AST using the existing full-rebuild behavior rather than a changed-file-only AST update.
- File moves stay as delete-plus-add in this story rather than adding separate rename detection, so an AST-supported move still counts as AST-relevant work.
- A file move that crosses the AST-supported boundary still counts as AST-relevant work if either side of the move is AST-supported.
- Markdown-only or other non-AST-only delta re-embeds no longer trigger a full AST rebuild.
- The story preserves current correctness guarantees for AST data by avoiding partial changed-file-only AST persistence logic.
- Existing ingest outputs, provider selection behavior, and root metadata remain compatible with the current ingest model unless a change is explicitly required for these optimizations.
- Existing ingest REST entrypoints and current ingest UI submission flow remain the active runtime path for this story; the story does not require a new browser surface or a second ingest API.
- Tests and documentation are updated to describe the new large-text chunking path, provider concurrency controls, and the refined AST rebuild trigger.
- Validation includes deterministic functional coverage plus one reproducible large-file proof scenario, without requiring a hard millisecond SLA or minimum percent-improvement threshold for acceptance.

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
- Adding a dedicated benchmark harness or a required minimum millisecond or percentage improvement threshold for this story.
- Adding a new frontend surface, a new ingest REST route, a new server listener, or a separate worker service just to deliver these optimizations.
- Changing websocket or browser-facing ingest contracts unless repository evidence later proves one is unavoidable.

### Additional Repositories

- No Additional Repositories

## Feasibility Proof Pass

### 1. Large-text chunking path

- Existing capabilities:
  - `server/src/ingest/discovery.ts` already discovers eligible text files by extension and text detection and returns `absPath`, `relPath`, and `ext`.
  - `server/src/ingest/chunker.ts` already has token-budget logic, context-length fallback logic, and a boundary-first split path before a generic slice fallback.
  - `server/src/ingest/config.ts` and `server/src/config/startupEnv.ts` already provide the repo's normal ingest env/config path.
- Missing prerequisite capabilities:
  - `DiscoveredFile` in `server/src/ingest/types.ts` does not currently include file size, so the ingest pipeline cannot choose a large-text path by size without re-statting files later.
  - `IngestConfig` in `server/src/ingest/types.ts` and `resolveConfig()` in `server/src/ingest/config.ts` do not currently expose a large-text threshold env var.
  - `chunkText(...)` in `server/src/ingest/chunker.ts` is generic and code-boundary-oriented today; there is no prose-specific Markdown splitter path selected by file type and size.
- Assumptions currently invalid:
  - It is false to assume the current chunker already prefers Markdown headings, fenced blocks, list boundaries, and paragraph breaks for very large prose files.
  - It is also false to assume discovery already preserves the size metadata this story wants to use for routing.
- Feasibility and sequencing note:
  - The lowest-risk upstream change is to add size to `DiscoveredFile`, extend ingest config with the large-text threshold env var, and let the server ingest layer choose between the current generic chunker path and a new prose-oriented path without adding a new route or service.

### 2. Provider-aware embedding dispatch and cancellation

- Existing capabilities:
  - `server/src/ingest/ingestJob.ts` already owns the main ingest orchestration, Chroma persistence, busy locking, status updates, and cancellation checks.
  - `server/src/ingest/providers/openaiEmbeddingProvider.ts` already has an internal multi-input OpenAI call path and token guardrail validation before sending a request.
  - `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` already has retry/error mapping for single-request LM Studio embeddings.
  - `server/src/ingest/requestContracts.ts` already resolves canonical embedding provider and model selection for ingest requests.
- Missing prerequisite capabilities:
  - `ProviderEmbeddingModel` in `server/src/ingest/providers/types.ts` only exposes single-item `embedText(...)`; there is no batch-oriented or abort-aware provider contract for the ingest layer to target.
  - `ingestJob.ts` currently embeds each chunk sequentially inside the file loop and only uses `flushEvery` for persistence batching, not provider-request concurrency.
  - There is no provider-aware dispatcher, no provider-specific batch/max-in-flight config surface, and no queue-cap setting in `server/src/ingest/config.ts` or `server/.env`.
  - There is no late-result fencing mechanism for multiple in-flight embedding requests because the current model is still single-flight and sequential.
- Assumptions currently invalid:
  - It is false to assume the current ingest path already supports bounded concurrent embedding requests.
  - It is also false to assume the current cancel path can safely ignore late results from multiple already-dispatched embedding requests, because that concurrency model does not exist yet.
- Feasibility and sequencing note:
  - The most maintainable fix is an upstream server-side dispatcher and provider-surface extension in the ingest layer, rather than route-local or provider-specific one-off concurrency logic.

### 3. Delta re-embed AST behavior

- Existing capabilities:
  - `server/src/ingest/deltaPlan.ts` already computes added, changed, unchanged, and deleted files by `relPath` and `fileHash`.
  - `server/src/ingest/ingestJob.ts` already has explicit delta no-op and deletions-only fast paths during re-embed.
  - `ingestJob.ts` already deletes and upserts AST records by changed/deleted `relPath` during delta re-embed.
- Missing prerequisite capabilities:
  - There is no separate `astRelevantDelta` decision layer that distinguishes generic delta work from AST-relevant delta work.
  - There is no existing branch that says "non-AST-only delta skips AST entirely, AST-relevant delta clears and rebuilds the full AST."
- Assumptions currently invalid:
  - It is false to assume the repo already rebuilds the full AST whenever a delta re-embed touches an AST-supported file.
  - The current delta path already performs partial AST updates by changed/deleted path, so the story must deliberately change that behavior if it wants the more conservative full-rebuild rule.
- Feasibility and sequencing note:
  - The safest implementation point is the existing delta decision area in `server/src/ingest/ingestJob.ts`, reusing the current full-clear/full-upsert path for AST-relevant delta runs instead of inventing a second AST persistence model.

## Runtime And Repo Prerequisites

Repository evidence says Story 54 is a single-repository, server-heavy optimization story that can ride on the runtime surfaces that already exist.

- Existing runtime entrypoints already cover the ingest flow:
  - `server/src/routes/ingestStart.ts`
  - `server/src/routes/ingestReembed.ts`
  - `server/src/routes/ingestCancel.ts`
- Existing server health/info listeners already exist in `server/src/index.ts`:
  - `/health`
  - `/version`
  - `/info`
- Existing build and runtime wrappers already exist in the root `package.json` and `scripts/docker-compose-with-env.sh`; Story 54 should keep using the wrapper-first workflow from `AGENTS.md`.
- No new frontend, separate backend service, HTTP listener, readiness endpoint, or Compose service is currently required by the repository evidence for this story. The existing ingest UI, server routes, and health surfaces are already present.
- New ingest env vars should follow the repo's existing server-env path:
  - whitelist and startup loading in `server/src/config/startupEnv.ts`
  - runtime parsing in `server/src/ingest/config.ts`
  - checked-in defaults in `server/.env`
  - environment-specific defaults in `server/.env.local` / `server/.env.e2e` when needed
  - user-facing docs in `README.md`

## Docker And Compose Constraints

Repository evidence shows that the current Docker and Compose model already supports this story and should be preserved.

- `server/Dockerfile` and `client/Dockerfile` copy repository code into images and build there. The story should preserve that image-build model rather than introducing host-source bind mounts for application code.
- The main runtime and e2e runtime are already defined in:
  - `docker-compose.yml`
  - `docker-compose.e2e.yml`
- Existing host-visible ports are already allocated and should be treated as reserved unless evidence later proves a new surface is unavoidable:
  - main stack: `5001`, `5010`, `5011`, `5012`, `8000`, `27517`, `4317`, `4318`, `9411`, `8932`
  - e2e stack: `6001`, `6010`, `6011`, `6012`, `8800`, `27617`, `4417`, `4418`, `9511`
- Existing `.dockerignore` files are already present:
  - `.dockerignore`
  - `client/.dockerignore`
  - `server/.dockerignore`
- Because this story should not add a new runtime service or source bind mount, Docker-related work is likely limited to env propagation and, only if required by new files, small ignore-file updates so unnecessary generated output is not sent into build context.
- Generated artifacts and persistent runtime data should continue to use the existing Docker-managed volumes and existing log mounts instead of new source-tree bind mounts.

## Message Contracts And Storage Shapes

Story 54 does not currently require a new REST route, websocket event type, or frontend payload shape.

- Existing ingest request-contract ownership already lives in `server/src/ingest/requestContracts.ts`, `server/src/routes/ingestStart.ts`, and `server/src/routes/ingestReembed.ts`.
- Existing persisted vector/root metadata already carries stable ingest identifiers and ordering inputs in `server/src/ingest/ingestJob.ts`, including `runId`, `root`, `relPath`, `fileHash`, `chunkHash`, `embeddingProvider`, and `embeddingModel`.
- Existing delta detection shape already lives in `server/src/ingest/deltaPlan.ts` and is based on `relPath` plus `fileHash`, not rename detection.
- Acceptable new shapes in this story should stay internal to the server ingest implementation, for example:
  - `DiscoveredFile` gaining `size`
  - `IngestConfig` gaining provider batch/max-in-flight/queue-cap settings
  - internal dispatcher queue items, batch items, or abort bookkeeping
  - provider helper methods for batch or abort-aware embedding calls
- The story should avoid introducing new browser-visible message contracts or storage schemas unless repository evidence later proves one is unavoidable. If concurrent embedding mixes files in the same OpenAI request, persisted metadata and final vector ordering must still remain deterministic.

## Test Harnesses

Repository evidence shows that Story 54 can use the existing test and validation harnesses rather than inventing new ones.

- Existing server unit tests already cover core ingest pieces such as:
  - `server/src/test/unit/chunker.test.ts`
  - `server/src/test/unit/ingest-delta-plan.test.ts`
  - `server/src/test/unit/ingest-ast-indexing.test.ts`
- Existing Cucumber/Testcontainers integration support already exists in:
  - `server/cucumber.js`
  - `server/src/test/support/chromaContainer.ts`
  - `server/src/test/support/mongoContainer.ts`
- Existing ingest-facing Cucumber features already exist under `server/src/test/features/`, including:
  - `ingest-batch-flush.feature`
  - `ingest-cancel.feature`
  - `ingest-delta-reembed.feature`
  - `ingest-reembed.feature`
  - `ingest-start.feature`
  - `ingest-status.feature`
- Existing browser/e2e proof already exists in:
  - `playwright.config.ts`
  - `e2e/ingest.spec.ts`
- Existing manual runtime proof paths are already documented in `README.md`, and the repo also has a Playwright MCP service in the checked-in main Compose stack.
- If Story 54 needs deterministic control over concurrent embedding timing, retries, or abort behavior, the first extension point should be the existing server test-support area, especially `server/src/test/support/mockLmStudioSdk.ts`, rather than a brand-new harness.
- Because the story changes backend ingest behavior behind an existing frontend, the final validation path should still expect server unit coverage, server Cucumber/Testcontainers coverage, e2e ingest coverage, and manual Playwright-MCP validation against the existing ingest UI.
- Later tasking should map proof locations explicitly rather than relying only on wrapper names:
  - large-text chunking behavior should point at `server/src/test/unit/chunker.test.ts` and the ingest start/status integration path;
  - dispatcher/concurrency/cancel behavior should point at `server/src/test/features/ingest-batch-flush.feature`, `server/src/test/features/ingest-cancel.feature`, and any focused support helper added under `server/src/test/support/`;
  - AST skip-vs-full-rebuild behavior should point at `server/src/test/unit/ingest-ast-indexing.test.ts` plus `server/src/test/features/ingest-delta-reembed.feature`;
  - browser-visible proof should continue through `e2e/ingest.spec.ts` and one manual Playwright-MCP pass against the existing ingest page, with screenshots only if the UI itself changes meaningfully.

## Log Or Proof Markers

- Large-text routing proof marker: `DEV-0000054:large_text_path_selected`
  - Expected outcome: one runtime log line per large-file prose-path selection with `runId`, `relPath`, `ext`, `sizeBytes`, `thresholdBytes`, and `strategy='prose'`, so manual validation can confirm the large-text route was chosen for the intended files.
- Embedding dispatcher proof marker: `DEV-0000054:embedding_dispatch_slot_filled`
  - Expected outcome: runtime logs show provider, effective batch size, effective max in-flight, queue depth, and immediate slot refill when a request completes, so reviewers can prove the dispatcher is slot-driven rather than wave-driven.
- Cancel late-result proof marker: `DEV-0000054:embedding_result_ignored_after_cancel`
  - Expected outcome: runtime logs show that a late provider result arrived after cancel and was ignored instead of being written, so cancellation semantics are provable even when provider abort is imperfect.
- Delta AST mode proof marker: `DEV-0000054:delta_ast_mode_selected`
  - Expected outcome: runtime logs show whether a delta re-embed chose `ast_skip_non_ast_delta` or `ast_full_rebuild`, together with the triggering file count, so the new AST rule is directly inspectable during integration and manual proof.

## Edge Cases And Failure Modes

- Large-file routing must stay narrow:
  - large `.md`, `.mdx`, and `.txt` files above the threshold should use the prose-oriented path;
  - smaller files and non-prose extensions should continue using the current generic chunker path unless the story explicitly changes that rule.
- Existing blank-input and blank-chunk guards must remain truthful:
  - `chunkText(...)` already filters blank chunks;
  - providers already reject blank embedding input.
- The story should preserve the existing no-change and deletions-only delta fast paths in `server/src/ingest/ingestJob.ts`, while making the AST rule explicit for those cases.
- Mixed-file OpenAI batching must preserve deterministic persisted metadata and result ordering even when chunks from different files share one request.
- Cancellation must stay coherent after concurrency is introduced:
  - stop scheduling new work immediately;
  - attempt best-effort aborts where the provider path supports them;
  - ignore late results from already-dispatched requests that finish after cancellation.
- Provider config above supported limits must clamp safely and not turn into a run failure just because an operator chose a large value.
- The dispatcher must not simply trade CPU slowness for unbounded memory growth. Queue-cap behavior and queue ownership must be explicit before implementation tasks are created.
- Because the current delta AST path is already partial by changed/deleted path, the story must be explicit about where the new conservative full-rebuild behavior begins and where AST work is skipped entirely, or implementers will accidentally preserve the current behavior.

### Resolved Questions

No Further Questions

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
4. OpenAI batches may mix chunks from different files.
   - The question being addressed: Should one OpenAI batch be allowed to mix chunks from different files, or should batches stay within one file?
   - Why the question matters: The story already says OpenAI can batch multiple inputs, but batching across file boundaries changes retry behavior, ordering, and how well small files can share provider capacity.
   - What the answer is: Allow batches to mix chunks from different files, as long as original file and chunk ordering metadata is preserved and persistence stays deterministic.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [server/src/ingest/ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), [server/src/ingest/providers/types.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/types.ts), [server/src/ingest/providers/openaiEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/openaiEmbeddingProvider.ts), and [server/src/ingest/chunker.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/chunker.ts), plus external evidence from official OpenAI embeddings docs and DeepWiki guidance that batches can safely mix items from different sources when ordering metadata is carried separately. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It lets the dispatcher keep provider slots full instead of waiting on one file at a time, while still preserving deterministic persisted output order.
5. Cancel should stop new embedding work immediately and ignore late results.
   - The question being addressed: When cancel is pressed, should new embedding work stop immediately even if a few requests are already finishing?
   - Why the question matters: The story already requires coherent cancellation with multiple requests in flight, but we still need one clear rule for what “cancel” means once some provider requests have already been sent.
   - What the answer is: Stop dispatching any new embedding work immediately, try to abort in-flight requests where the provider/client supports it, and ignore late-arriving results from requests that were already too far along to stop.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [server/src/ingest/ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), [server/src/ingest/providers/openaiEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/openaiEmbeddingProvider.ts), [server/src/ingest/providers/lmstudioEmbeddingProvider.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/providers/lmstudioEmbeddingProvider.ts), and [server/src/routes/ingestCancel.ts](/home/d_a_s/code/codeInfo2/server/src/routes/ingestCancel.ts), plus external evidence from MDN `AbortController` guidance and DeepWiki queue-cancellation patterns. Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: It makes cancel feel immediate without depending on every provider to support perfect mid-flight aborts, and it prevents cancelled work from writing late results back into the run.
6. Moves across the AST-supported boundary still count as AST-relevant.
   - The question being addressed: If a file move crosses the AST-supported boundary, should it still count as AST-relevant work?
   - Why the question matters: The story already keeps moves as delete-plus-add, but a move from unsupported to supported, or supported to unsupported, still needs one clear AST rule.
   - What the answer is: If either side of the move is AST-supported, treat the move as AST-relevant and rebuild the full AST.
   - Where the answer came from: User decision in this planning session, supported by repo evidence from [planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md](/home/d_a_s/code/codeInfo2/planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md), [server/src/ingest/deltaPlan.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/deltaPlan.ts), [server/src/ingest/ingestJob.ts](/home/d_a_s/code/codeInfo2/server/src/ingest/ingestJob.ts), and [server/src/test/unit/ingest-ast-indexing.test.ts](/home/d_a_s/code/codeInfo2/server/src/test/unit/ingest-ast-indexing.test.ts). Context7 could not be queried because the workspace quota is exhausted today.
   - Why it is the best answer: A delete-plus-add across the AST boundary changes which files belong in the AST dataset, so the conservative full rebuild rule should still apply.
7. Use one checked-in ingest env var for the large-text threshold, defaulted to `65536` bytes.
   - The question being addressed: What is the exact default large-text size threshold, and should it be a checked-in env var, a typed server config value, or a hard-coded-only constant?
   - Why the question matters: The story needs one clear switch for when large prose files leave the current general chunker path, and that choice affects operator tuning, code simplicity, and whether future adjustments require source changes.
   - What the answer is: Add one checked-in env var named `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES`, resolve it through `server/src/ingest/config.ts` into the typed ingest config, and default it to `65536` bytes. Treat that value as the minimum file size for the dedicated large-text prose path for `.md`, `.mdx`, and `.txt` files.
   - Where the answer came from: `code_info` research in this repository and across all ingested repositories showed the closest existing pattern is env-backed ingest policy in [server/src/ingest/config.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/config.ts), [server/src/ingest/types.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/types.ts), [server/src/config/startupEnv.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/config/startupEnv.ts), and [server/.env](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/.env), not route-level query parameters. Context7 LangChain splitter docs and DeepWiki for `langchain-ai/langchain` both confirmed that Markdown splitters expose chunk-size behavior but do not define a built-in file-size threshold, so file-size gating belongs in the application. External web research also showed conservative large-text systems applying guards in this general range, including GitHub's diff limits at `100KB` of diff text per file in its large-diff performance work.
   - Why it is the best answer: It follows the repo's existing ingest-config style, keeps the new tuning surface to one purposeful knob, avoids hard-coding a value that operators cannot adjust, and keeps the default conservative enough to target genuinely large prose files without routing every ordinary note through the special path.
8. Use deterministic functional coverage plus one reproducible large-file proof scenario, not a hard benchmark gate.
   - The question being addressed: Does this story need an explicit measurable proof target for "faster" ingest, such as a required before/after benchmark or minimum improvement threshold?
   - Why the question matters: Performance stories can easily expand into benchmark-harness work or unstable timing gates, so the plan needs one explicit proof contract that stays honest without widening scope.
   - What the answer is: Keep the acceptance bar to deterministic functional coverage plus one reproducible large-file validation scenario. The story should prove the new large-text path, overlap between chunking and embedding, bounded provider dispatch, cancellation behavior, and the AST skip/full-rebuild gate, but it should not require a minimum millisecond SLA, percentage improvement target, or new benchmark harness.
   - Where the answer came from: `code_info` research in this repository and across all ingested repositories found the closest precedents in [planning/0000005-ingest-embeddings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000005-ingest-embeddings.md), which explicitly keeps broader benchmarking out of scope, and [planning/0000049-responsive-long-conversation-transcript-rendering.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000049-responsive-long-conversation-transcript-rendering.md), which requires a reproducible proof scenario but not a hard millisecond SLA. External web research, including GitHub's diff-performance write-up, also supports validating representative workloads and behavior changes without inventing one universal hard threshold for every run.
   - Why it is the best answer: It gives reviewers a repeatable way to confirm the story's user-visible performance win while keeping implementation effort focused on the actual ingest behavior, tests, and logging instead of spinning up a broader benchmarking system that this story does not need.

## Implementation Ideas

- Extend `DiscoveredFile` to include `size` so the chunker can choose a large-text strategy without an extra stat call later.
- Add `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES=65536` to the checked-in server env/config path so the prose splitter threshold follows the repo's existing ingest-config pattern.
- Add a prose-oriented chunking strategy in the ingest chunker for large `.md`, `.mdx`, and `.txt` files that splits on headings, blank lines, fenced code blocks, and list boundaries before local fallback cuts.
- Convert chunk production into a streaming or incremental shape so large-file chunking and embedding can overlap instead of forcing a full-file chunking pause up front.
- Introduce an embedding dispatcher that preserves chunk order while supporting provider-aware batching and provider-aware request concurrency.
- Extend `ProviderEmbeddingModel` or an adjacent provider helper surface so the ingest layer can request batch-oriented and abort-aware embedding work without pushing dispatcher logic into routes or UI callers.
- Add provider-specific configuration such as `CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE`, `CODEINFO_INGEST_OPENAI_MAX_INFLIGHT`, `CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE`, and `CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT`, documented in the checked-in `.env` file with short explanations of what each setting controls.
- Seed the checked-in `.env` file with the initial agreed defaults and explanations: OpenAI batch size `20`, OpenAI max in-flight `10`, LM Studio batch size `1`, and LM Studio max in-flight `4`.
- Add a server queue-cap env var such as `CODEINFO_INGEST_MAX_QUEUE_SIZE=-1`, documented in `server/.env` so operators know that `-1` disables the extra cap, `0` disables the waiting queue, and positive values cap queue depth.
- Clamp configured provider values to provider-supported limits at runtime, so unsupported high values degrade safely instead of failing the run or emitting a warning for that reason alone.
- Keep the dispatcher inside the existing server ingest path in `server/src/ingest/ingestJob.ts` or closely related ingest helpers instead of adding a new route, worker service, or browser-facing mode switch.
- Keep the dispatcher queue bounded so performance gains do not come at the cost of uncontrolled memory growth on very large text files.
- Allow OpenAI batches to mix chunks from different files, but preserve stable file and chunk indexes so persistence order stays deterministic.
- Use slot-based dispatch so each completed in-flight request immediately pulls the next queued embedding work instead of waiting for an entire wave to finish.
- Apply the absolute queue cap after the normal queue-sizing logic so the env value acts as a memory-protection ceiling rather than replacing the default queue behavior.
- Preserve deterministic metadata ordering by carrying original file and chunk indexes through the concurrent dispatch path and reassembling results in that stable order before persistence.
- On cancel, stop scheduling new embedding work immediately, attempt best-effort aborts for in-flight requests where supported, and ignore any late results that still arrive after cancellation.
- During delta re-embed, derive a separate `astRelevantDelta` check from the normal delta plan and only enter the AST rebuild path when that filtered delta contains at least one AST-supported add, change, or delete.
- Treat file moves as delete-plus-add rather than adding rename detection, so AST-supported moves naturally fall into the same conservative AST-relevant path.
- Treat moves across the AST-supported boundary as AST-relevant if either side of the move is AST-supported.
- Reuse the existing full AST rebuild path when `astRelevantDelta` is non-empty rather than designing a partial AST persistence model in this story.
- Add targeted unit and integration coverage for large Markdown chunking, provider concurrency limits, concurrent result ordering, cancellation with in-flight requests, OpenAI batch guardrails, LM Studio concurrency caps, and the new AST skip/full-rebuild gate.
- Extend existing server test support, especially `server/src/test/support/mockLmStudioSdk.ts`, if deterministic concurrency or late-result timing control is needed for proof; do not create a second ingest-specific harness unless the current support layer proves insufficient.
- Keep proof scoped to targeted automated coverage plus one reproducible large-file validation scenario instead of adding a benchmark harness or hard performance SLA.

## Questions

- No Further Questions
