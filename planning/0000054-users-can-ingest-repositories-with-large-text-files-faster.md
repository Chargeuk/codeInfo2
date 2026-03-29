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

# Tasks

### Task 1. Add Large-Text Discovery Metadata, Threshold Config, And Prose Chunk Routing

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__done__`
- Git Commits:
  - `b809b9ce` - `DEV-[54] - Add large-text ingest routing`

#### Overview

This task adds the upstream inputs that let the ingest pipeline recognize genuinely large prose files before embedding begins. It must carry file size out of discovery, expose the checked-in large-text threshold through the normal ingest config path, and add a prose-oriented chunking strategy for large `.md`, `.mdx`, and `.txt` files without changing the existing behavior for other file types.

#### Task Exit Criteria

- Discovery returns file size metadata, the server config exposes `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES` with default `65536`, and large prose files can be routed to a prose-specific chunking path without an extra filesystem stat later.
- The prose chunker prefers headings, blank lines, fenced blocks, and list boundaries, still respects token limits, still filters blank chunks truthfully, and is proved by focused unit coverage.

#### Documentation Locations

- OpenAI embeddings API reference: https://developers.openai.com/api-reference/embeddings/create . Use this to keep the prose chunking path aligned with the single-input constraints that still apply before batching.
- OpenAI embeddings guide: https://platform.openai.com/docs/guides/embeddings . Use this to keep the new chunking route compatible with the existing embedding model budget assumptions already enforced in the repo.

#### Subtasks

1. [x] Read the Story 54 Description, Acceptance Criteria, Edge Cases, and Log Or Proof Markers, then inspect `server/src/ingest/types.ts`, `server/src/ingest/discovery.ts`, `server/src/ingest/config.ts`, `server/src/config/startupEnv.ts`, `server/src/ingest/chunker.ts`, `server/src/ingest/__fixtures__/sample.ts`, `server/src/test/unit/discovery.test.ts`, `server/src/test/unit/env-loading.test.ts`, and `server/src/test/unit/chunker.test.ts` so the change starts from the current discovery/config/chunker contracts instead of guessing at them.
2. [x] Update `server/src/ingest/types.ts` and `server/src/ingest/discovery.ts` so every `DiscoveredFile` includes byte size taken from the existing `fs.stat()` result that discovery already performs. Preserve the current include/exclude filtering, text-file detection, and path normalization behavior; do not add a second stat pass later in the pipeline.
3. [x] Add `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES` to the checked-in ingest env/config path by updating `server/src/config/startupEnv.ts`, `server/src/ingest/types.ts`, `server/src/ingest/config.ts`, and `server/.env`. Parse it into typed ingest config, default it to `65536`, and clamp invalid or non-finite values back to that default instead of crashing startup.
4. [x] Extend `server/src/ingest/chunker.ts` so large `.md`, `.mdx`, and `.txt` files can take a prose-oriented route selected by file extension plus `DiscoveredFile.size`. The prose route must prefer Markdown headings, blank-line paragraph breaks, fenced code blocks, and list breaks before local slice fallback, must avoid repeatedly re-tokenizing the whole remaining tail when a local boundary cut is available, and must emit `DEV-0000054:large_text_path_selected` with `runId`, `relPath`, `ext`, `sizeBytes`, `thresholdBytes`, and `strategy='prose'` when the large-text path is chosen during ingest.
5. [x] Update `server/src/test/unit/discovery.test.ts` to prove the requirement “discovery keeps file size metadata for later large-text routing” against the implementation owned by `server/src/ingest/discovery.ts` and `server/src/ingest/types.ts`. The assertions should confirm that eligible files now include byte size and that existing include/exclude/text-detection behavior still works with the new shape.
6. [x] Update `server/src/test/unit/env-loading.test.ts` to prove the requirement “`CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES` resolves through the checked-in env/config path with default `65536` and safe fallback on invalid values” against the implementation owned by `server/src/config/startupEnv.ts`, `server/src/ingest/config.ts`, and `server/src/ingest/types.ts`.
7. [x] Update `server/src/ingest/__fixtures__/sample.ts` and `server/src/test/unit/chunker.test.ts` to prove the requirements “only large `.md` / `.mdx` / `.txt` files take the prose route,” “the prose route prefers headings / blank lines / fenced blocks / list breaks before fallback slicing,” and “the prose route still enforces token limits and blank-chunk filtering” against the implementation owned by `server/src/ingest/chunker.ts`. If any existing test name now implies the old generic-only behavior, rename that test at the same time so the title still matches the assertion.
8. [x] Run `npx eslint server/src/ingest/types.ts server/src/ingest/discovery.ts server/src/ingest/config.ts server/src/config/startupEnv.ts server/src/ingest/chunker.ts server/src/ingest/__fixtures__/sample.ts server/src/test/unit/discovery.test.ts server/src/test/unit/env-loading.test.ts server/src/test/unit/chunker.test.ts --max-warnings=0`. The pass condition is zero errors and zero warnings. If ESLint can fix an issue automatically, try the same command again with `--fix` before making manual style edits.
9. [x] Run `npx prettier --check server/src/ingest/types.ts server/src/ingest/discovery.ts server/src/ingest/config.ts server/src/config/startupEnv.ts server/src/ingest/chunker.ts server/src/ingest/__fixtures__/sample.ts server/src/test/unit/discovery.test.ts server/src/test/unit/env-loading.test.ts server/src/test/unit/chunker.test.ts`. The pass condition is that every listed file is already formatted. If Prettier reports differences, run the same file list with `npx prettier --write` before making manual formatting changes.

#### Testing

1. [x] Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/discovery.test.ts` and confirm the discovery-size proof passes.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/env-loading.test.ts` and confirm the large-text threshold env proof passes.
4. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/chunker.test.ts` and confirm the prose-chunker routing and token-limit proofs pass.

#### Implementation notes

- Subtask 1: Re-read the story requirements, OpenAI embeddings docs, and the current discovery/config/chunker contracts before editing. Confirmed the large-text route must stay file-type-and-size gated and that the current chunker only has code-boundary splitting today.
- Subtask 2: Added `size` to `DiscoveredFile` and wired discovery to carry the existing `fs.stat()` byte count forward without changing include/exclude or text detection behavior.
- Subtask 3: Added `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES` to the startup env whitelist, typed ingest config, runtime parsing, and checked-in `server/.env`, with invalid or sub-minimum values falling back to `65536`.
- Subtask 4: Added a prose-specific chunking path for large `.md` / `.mdx` / `.txt` files, using headings, blank-line blocks, fenced blocks, list boundaries, and local fallback slicing; also logged `DEV-0000054:large_text_path_selected` from the real ingest call path.
- Subtask 5: Expanded discovery unit coverage to assert file sizes are preserved on eligible discovered files.
- Subtask 6: Added env-loading coverage for the large-text threshold, including startup-env visibility plus runtime default and invalid-value fallback behavior.
- Subtask 7: Added prose-route fixtures and chunker unit coverage for routing, Markdown boundary preference, token-limit enforcement, and blank-chunk filtering.
- Subtask 8: `npx eslint ... --max-warnings=0` passed cleanly for the Task 1 file list without needing auto-fixes.
- Subtask 9: Prettier initially reported four files, so I ran `npx prettier --write` on the Task 1 file list and re-ran `--check` until it passed cleanly.
- Testing 1: `npm run build:summary:server` passed on the rerun after threading `ext` and `size` through delta work items so the ingest call path could supply file metadata during full and delta runs.
- Testing 2: `npm run test:summary:server:unit -- --file server/src/test/unit/discovery.test.ts` passed with 4/4 tests green, confirming discovery keeps byte sizes on eligible files.
- Testing 3: `npm run test:summary:server:unit -- --file server/src/test/unit/env-loading.test.ts` passed with 9/9 tests green, including the new large-text threshold default and invalid-value fallback coverage.
- Testing 4: `npm run test:summary:server:unit -- --file server/src/test/unit/chunker.test.ts` passed with 14/14 tests green after tightening one prose-route assertion to match the intended boundary-preserving split rather than a brittle fixed chunk count.

---

### Task 2. Add Provider Dispatch Settings And A Batch-Aware Embedding Provider Contract

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__done__`
- Git Commits:
  - `7b736f42` - `DEV-[54] - Add provider dispatch contract and config`

#### Overview

This task creates the provider-side contract that the ingest job will need before it can dispatch embeddings concurrently. It must add provider-specific batching and max-in-flight settings, clamp those settings to provider-supported limits, and expose a batch-aware, abort-aware provider seam that keeps OpenAI and LM Studio behavior explicit instead of hiding provider differences inside `ingestJob.ts`.

#### Task Exit Criteria

- Typed ingest config exposes provider-specific batch-size, max-in-flight, and absolute queue-cap settings with the story defaults and provider-specific clamp behavior.
- The ingest layer has a provider contract it can call for multi-input OpenAI requests and abort-aware LM Studio/OpenAI embedding work, while LM Studio still behaves as effective batch size `1` and OpenAI still obeys existing guardrails.

#### Documentation Locations

- OpenAI embeddings API reference: https://developers.openai.com/api-reference/embeddings/create . Use this for the multi-input request shape and response ordering expectations.
- OpenAI embeddings guide: https://platform.openai.com/docs/guides/embeddings . Use this to keep provider-side batching inside the supported embeddings workflow rather than inventing a repo-specific contract.
- MDN AbortController / AbortSignal documentation: https://developer.mozilla.org/en-US/docs/Web/API/AbortController . Use this for the best-effort abort semantics the provider contract should expose to the ingest dispatcher.

#### Subtasks

1. [x] Read the Story 54 Decisions, Acceptance Criteria, and Log Or Proof Markers, then inspect `server/src/ingest/types.ts`, `server/src/ingest/config.ts`, `server/src/config/startupEnv.ts`, `server/.env`, `server/src/ingest/providers/types.ts`, `server/src/ingest/providers/openaiConstants.ts`, `server/src/ingest/providers/openaiEmbeddingProvider.ts`, `server/src/ingest/providers/openaiGuardrails.ts`, `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`, `server/src/test/unit/openai-provider.test.ts`, `server/src/test/unit/openai-provider-guardrails.test.ts`, `server/src/test/unit/lmstudio-provider-retry-logging.test.ts`, and `server/src/test/unit/env-loading.test.ts` so the provider contract follows the current retry, guardrail, and env-loading patterns already used in this repo.
2. [x] Extend the typed ingest config and env-loading path in `server/src/ingest/types.ts`, `server/src/ingest/config.ts`, `server/src/config/startupEnv.ts`, and `server/.env` with the Story 54 settings: `CODEINFO_INGEST_OPENAI_MAX_BATCH_SIZE`, `CODEINFO_INGEST_OPENAI_MAX_INFLIGHT`, `CODEINFO_INGEST_LMSTUDIO_MAX_BATCH_SIZE`, `CODEINFO_INGEST_LMSTUDIO_MAX_INFLIGHT`, and `CODEINFO_INGEST_MAX_QUEUE_SIZE`. Default them to OpenAI batch `20`, OpenAI max in-flight `10`, LM Studio batch `1`, LM Studio max in-flight `4`, and queue cap `-1`; clamp over-large values to provider-supported limits without warning or failure; treat queue cap `-1`, `0`, and positive values exactly as described in the story.
3. [x] Replace the single-item-only provider seam in `server/src/ingest/providers/types.ts` with a contract the ingest job can use for provider-aware dispatch. Update `server/src/ingest/providers/openaiEmbeddingProvider.ts` to expose a reusable multi-input embedding call with abort support and preserved response-index ordering, and update `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` so the ingest layer can launch multiple single-input LM Studio requests concurrently while still reporting effective batch size `1`. Keep provider-specific batching logic in the provider layer or a dedicated ingest-provider helper, not inside routes or the UI.
4. [x] Update `server/.env` in its own documentation subtask so the checked-in file explains the new provider dispatch knobs and the queue-cap behavior in plain language next to the actual defaults. Do not hide these defaults only in code or README text.
5. [x] Create `server/src/test/unit/ingest-dispatch-config.test.ts` to prove the requirement “provider dispatch settings resolve to the Story 54 defaults and clamp to provider-supported effective values” against the implementation owned by `server/src/ingest/config.ts`, `server/src/ingest/types.ts`, and `server/src/config/startupEnv.ts`. Cover OpenAI batch `20`, OpenAI max in-flight `10`, LM Studio effective batch `1`, LM Studio max in-flight `4`, and queue-cap values `-1`, `0`, and positive integers.
6. [x] Update `server/src/test/unit/env-loading.test.ts` to prove the requirement “the new provider dispatch env vars are actually loaded from the checked-in startup env path and survive the same whitelist rules as the existing ingest env vars” against the implementation owned by `server/src/config/startupEnv.ts` and `server/.env`.
7. [x] Update `server/src/test/unit/openai-provider.test.ts` to prove the requirements “OpenAI can accept multi-input embedding requests through the new provider contract,” “response ordering remains stable after index sorting,” and “the provider contract can carry abort-aware request state” against the implementation owned by `server/src/ingest/providers/types.ts` and `server/src/ingest/providers/openaiEmbeddingProvider.ts`. If an existing test title still claims only single-input behavior, rename or split that test so the title matches the broader multi-input invariant.
8. [x] Update `server/src/test/unit/openai-provider-guardrails.test.ts` to prove the requirement “OpenAI batching still honors existing per-request guardrails even when config asks for a larger batch” against the implementation owned by `server/src/ingest/providers/openaiGuardrails.ts`, `server/src/ingest/providers/openaiConstants.ts`, and `server/src/ingest/providers/openaiEmbeddingProvider.ts`. If an existing test title only claims generic validation, rename it so the batching guardrail invariant is explicit.
9. [x] Create `server/src/test/unit/lmstudio-provider-dispatch.test.ts` to prove the requirement “LM Studio still behaves as effective batch size `1` even when configured higher” against the implementation owned by `server/src/ingest/providers/lmstudioEmbeddingProvider.ts` and `server/src/ingest/providers/types.ts`. Do not overload `server/src/test/unit/lmstudio-provider-retry-logging.test.ts` with this new invariant, because that file name already claims retry/logging semantics rather than dispatch-shape semantics.
10. [x] Update `server/src/test/unit/lmstudio-provider-retry-logging.test.ts` only for the requirement “the LM Studio provider contract still preserves retry and error logging behavior under the new dispatch seam” against the implementation owned by `server/src/ingest/providers/lmstudioEmbeddingProvider.ts`. If a test in that file drifts away from retry/logging and starts proving dispatch shape instead, split it into `server/src/test/unit/lmstudio-provider-dispatch.test.ts` instead of keeping a misleading title.
11. [x] Run `npx eslint server/src/ingest/types.ts server/src/ingest/config.ts server/src/config/startupEnv.ts server/src/ingest/providers/types.ts server/src/ingest/providers/openaiConstants.ts server/src/ingest/providers/openaiEmbeddingProvider.ts server/src/ingest/providers/openaiGuardrails.ts server/src/ingest/providers/lmstudioEmbeddingProvider.ts server/src/test/unit/ingest-dispatch-config.test.ts server/src/test/unit/env-loading.test.ts server/src/test/unit/openai-provider.test.ts server/src/test/unit/openai-provider-guardrails.test.ts server/src/test/unit/lmstudio-provider-dispatch.test.ts server/src/test/unit/lmstudio-provider-retry-logging.test.ts --max-warnings=0`. The pass condition is zero ESLint errors and zero warnings. If the linter can fix an issue automatically, rerun with `--fix` before editing by hand.
12. [x] Run `npx prettier --check server/src/ingest/types.ts server/src/ingest/config.ts server/src/config/startupEnv.ts server/src/ingest/providers/types.ts server/src/ingest/providers/openaiConstants.ts server/src/ingest/providers/openaiEmbeddingProvider.ts server/src/ingest/providers/openaiGuardrails.ts server/src/ingest/providers/lmstudioEmbeddingProvider.ts server/src/test/unit/ingest-dispatch-config.test.ts server/src/test/unit/env-loading.test.ts server/src/test/unit/openai-provider.test.ts server/src/test/unit/openai-provider-guardrails.test.ts server/src/test/unit/lmstudio-provider-dispatch.test.ts server/src/test/unit/lmstudio-provider-retry-logging.test.ts server/.env`. The pass condition is that every listed file is already formatted. If Prettier reports differences, run the same list with `npx prettier --write` before manual formatting changes.

#### Testing

1. [x] Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/env-loading.test.ts` and confirm the new provider dispatch env-default and clamping proofs pass.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/openai-provider.test.ts` and confirm the OpenAI batch contract proofs pass.
4. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/openai-provider-guardrails.test.ts` and confirm the OpenAI request-limit guardrail proofs pass.
5. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/lmstudio-provider-dispatch.test.ts` and confirm the LM Studio effective-batch-size dispatch proofs pass.
6. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/lmstudio-provider-retry-logging.test.ts` and confirm the LM Studio retry and logging proofs still pass under the new contract.
7. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-dispatch-config.test.ts` and confirm the effective dispatch-config matrix passes.

#### Implementation notes

- Subtask 1: Re-read the Story 54 provider decisions, OpenAI embeddings docs, MDN AbortController docs, and the current provider/config tests before editing. Confirmed the existing seam was still single-item-only even though OpenAI already had an internal multi-input helper.
- Subtask 2: Added provider dispatch env fields to the typed ingest config and startup env whitelist, with defaults of OpenAI batch `20`, OpenAI in-flight `10`, LM Studio batch `1`, LM Studio in-flight `4`, and queue cap `-1`; oversized values now clamp to provider-supported caps.
- Subtask 3: Extended the provider model contract with `embedBatch`, `effectiveBatchSize`, `supportsAbort`, and optional request options so OpenAI can batch with signal propagation and LM Studio can keep single-input request shape while supporting concurrent single-request calls.
- Subtask 4: Documented the new provider dispatch knobs and queue-cap behavior directly in `server/.env` next to the checked-in defaults.
- Subtask 5: Added `server/src/test/unit/ingest-dispatch-config.test.ts` to prove the new config defaults, clamp behavior, and queue-cap semantics.
- Subtask 6: Expanded env-loading coverage so the new dispatch env vars prove out through the checked-in startup env path and stay visible in the rename inventory.
- Subtask 7: Added OpenAI provider coverage for multi-input batching, response-index sorting, and signal propagation through the new provider contract.
- Subtask 8: Added a provider-level OpenAI guardrail proof that oversized batch requests are rejected before any SDK call is sent.
- Subtask 9: Added `server/src/test/unit/lmstudio-provider-dispatch.test.ts` to prove LM Studio reports effective batch size `1`, rejects multi-input batches, and still allows concurrent single-input calls through the provider seam.
- Subtask 10: Updated the LM Studio retry/logging proof to exercise the new optional request options while preserving the existing retry and terminal logging assertions.
- Subtask 11: ESLint reported one import-order warning in `server/src/ingest/config.ts`, so I ran the allowed `--fix` pass and then re-ran the exact Task 2 lint command until it passed cleanly.
- Subtask 12: Prettier reformatted three Task 2 files, then passed on the full TS file list; `server/.env` required a temporary `prettier-plugin-sh` install because this repo’s default Prettier setup cannot infer a parser for `.env`, and the plugin-backed check then passed cleanly without changing repo manifests.
- Testing 1: `npm run build:summary:server` passed after tightening the shared chunker test helper to return a fully-typed `IngestConfig` with the new dispatch settings included.
- Testing 2: `npm run test:summary:server:unit -- --file server/src/test/unit/env-loading.test.ts` passed with 10/10 tests green, including the new provider dispatch env whitelist coverage.
- Testing 3: `npm run test:summary:server:unit -- --file server/src/test/unit/openai-provider.test.ts` passed with 8/8 tests green, covering multi-input batching, response sorting, and signal propagation through the OpenAI provider seam.
- Testing 4: `npm run test:summary:server:unit -- --file server/src/test/unit/openai-provider-guardrails.test.ts` passed with 7/7 tests green, including the provider-level proof that oversized batch requests are blocked before any SDK call.
- Testing 5: `npm run test:summary:server:unit -- --file server/src/test/unit/lmstudio-provider-dispatch.test.ts` passed with 2/2 tests green, proving LM Studio keeps effective batch size `1` while allowing concurrent single-input calls through separate requests.
- Testing 6: `npm run test:summary:server:unit -- --file server/src/test/unit/lmstudio-provider-retry-logging.test.ts` passed with 3/3 tests green, confirming the new request-options seam did not break LM Studio retry or terminal logging behavior.
- Testing 7: `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-dispatch-config.test.ts` passed with 3/3 tests green, covering the new dispatch-setting defaults, provider clamps, and queue-cap behavior.

---

### Task 3. Replace The Serial Ingest Loop With A Slot-Driven Dispatcher And Late-Result Fencing

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1, Task 2`
- Task Status: `__done__`
- Git Commits:
  - `3e26cd8f` - `DEV-[54] - Add slot-driven ingest dispatch`

#### Overview

This task is the runtime heart of Story 54. It must stop the ingest job from waiting on one chunk at a time, overlap chunk production with embedding dispatch, keep memory bounded, preserve deterministic persisted ordering even when OpenAI batches mix files, and make cancel coherent when requests are already in flight.

#### Task Exit Criteria

- The ingest job dispatches embeddings through a slot-driven provider-aware queue, starts embedding work before a large prose file has been fully chunked, and preserves deterministic vector metadata and persistence order.
- Cancel stops new dispatch immediately, attempts best-effort aborts where supported, ignores late results that arrive after cancellation, and emits the Story 54 dispatch/cancel proof markers.

#### Documentation Locations

- OpenAI embeddings API reference: https://developers.openai.com/api-reference/embeddings/create . Use this for mixed-input request ordering and multi-input response handling.
- OpenAI embeddings guide: https://platform.openai.com/docs/guides/embeddings . Use this to keep runtime batching behavior inside the documented embeddings flow.
- MDN AbortController / AbortSignal documentation: https://developer.mozilla.org/en-US/docs/Web/API/AbortController . Use this for best-effort cancellation wiring and late-result handling around aborted requests.

#### Subtasks

1. [x] Read the Story 54 Description, Acceptance Criteria, Edge Cases, Decisions, and Log Or Proof Markers, then inspect `server/src/ingest/ingestJob.ts`, `server/src/ingest/chunker.ts`, `server/src/ingest/types.ts`, `server/src/ingest/providers/types.ts`, `server/src/test/support/mockLmStudioSdk.ts`, `server/src/test/unit/ingest-cancel.test.ts`, `server/src/test/features/ingest-batch-flush.feature`, `server/src/test/steps/ingest-batch-flush.steps.ts`, `server/src/test/features/ingest-cancel.feature`, `server/src/test/steps/ingest-manage.steps.ts`, `e2e/ingest.spec.ts`, and the checked-in ingest fixture directory `e2e/fixtures/repo` that the runtime mounts as `/fixtures/repo`, so the dispatcher work fits the real ingest orchestration and proof harnesses already present.
2. [x] Refactor the serial embedding path in `server/src/ingest/ingestJob.ts` into a slot-driven provider-aware dispatcher. If the logic becomes too large for `ingestJob.ts`, extract a focused helper such as `server/src/ingest/embeddingDispatcher.ts`, but keep it inside the existing server ingest layer. The dispatcher must: overlap chunk production with embedding dispatch for large files, size the waiting queue from max-in-flight behavior, apply `CODEINFO_INGEST_MAX_QUEUE_SIZE` as an absolute ceiling, refill a free slot immediately instead of waiting for a whole wave to finish, and preserve deterministic `relPath`, `chunkIndex`, `chunkHash`, and persistence ordering even when one OpenAI request contains chunks from multiple files.
3. [x] Update the ingest cancellation path in `server/src/ingest/ingestJob.ts` and any helper created in this task so cancel stops new embedding work immediately, creates and passes abort signals into provider requests where the provider contract supports them, and fences off late-arriving results so they are ignored rather than written after cancellation. Emit `DEV-0000054:embedding_dispatch_slot_filled` when the dispatcher refills capacity and `DEV-0000054:embedding_result_ignored_after_cancel` when a late result is intentionally dropped after cancel.
4. [x] Add or update the deterministic proof fixtures and harness seams needed for this task. Update `server/src/test/support/mockLmStudioSdk.ts` and any affected ingest step helper such as the new `server/src/test/steps/ingest-embedding-dispatch.steps.ts` or the existing `server/src/test/steps/ingest-manage.steps.ts` so the test suite can reproduce concurrent completion order, queue-depth backpressure, cancel-after-dispatch, and large-file overlap without relying on fragile timing guesses. Add or update a deterministic large-text fixture under `e2e/fixtures/repo` so the same checked-in fixture can serve the runtime path `/fixtures/repo` during browser and manual proof.
5. [x] Add or update the reproducible proof artifact `e2e/fixtures/repo/large-planning-doc.md` to prove the requirement “there is one deterministic large-file scenario that exercises the large-text route through the normal ingest path” against the implementation owned by `server/src/ingest/chunker.ts` and `server/src/ingest/ingestJob.ts`. Keep the document small enough for the repo to carry comfortably, but large enough to cross `CODEINFO_INGEST_LARGE_TEXT_THRESHOLD_BYTES=65536` during the mounted runtime path `/fixtures/repo`.
6. [x] Create `server/src/test/unit/ingest-dispatcher.test.ts` to prove the requirements “the dispatcher refills a free slot immediately,” “waiting work stays bounded by the derived queue plus `CODEINFO_INGEST_MAX_QUEUE_SIZE`,” “OpenAI mixed-file batches still persist deterministic metadata order,” and “large-text chunk production can overlap with first embedding dispatch” against the implementation owned by `server/src/ingest/ingestJob.ts` and `server/src/ingest/embeddingDispatcher.ts` if that helper is created.
7. [x] Update `server/src/test/unit/ingest-cancel.test.ts` to prove the requirements “cancel stops new embedding work immediately” and “late results are ignored after cancellation instead of being written” against the implementation owned by `server/src/ingest/ingestJob.ts` plus the abort-aware provider contract added in Task 2.
8. [x] Create `server/src/test/features/ingest-embedding-dispatch.feature` and `server/src/test/steps/ingest-embedding-dispatch.steps.ts` to prove the integration-level invariant “dispatch is slot-driven rather than wave-driven” and to capture `DEV-0000054:embedding_dispatch_slot_filled` from behavior owned by `server/src/ingest/ingestJob.ts`. Do not overload `server/src/test/features/ingest-batch-flush.feature` for this proof, because that feature title claims flush cadence semantics rather than dispatcher-slot semantics.
9. [x] Update `server/src/test/features/ingest-cancel.feature` and `server/src/test/steps/ingest-manage.steps.ts` to prove the integration-level invariants “cancel blocks new dispatch immediately” and “late provider results are ignored after cancel,” and to capture `DEV-0000054:embedding_result_ignored_after_cancel` from behavior owned by `server/src/ingest/ingestJob.ts`. If an existing scenario title only says “cancel an in-flight ingest,” add a separate scenario or rename it so the late-result invariant is explicit.
10. [x] Run `npx eslint server/src/ingest/ingestJob.ts server/src/ingest/embeddingDispatcher.ts server/src/test/support/mockLmStudioSdk.ts server/src/test/unit/ingest-dispatcher.test.ts server/src/test/unit/ingest-cancel.test.ts server/src/test/steps/ingest-embedding-dispatch.steps.ts server/src/test/steps/ingest-manage.steps.ts --max-warnings=0`. The pass condition is zero ESLint errors and zero warnings for the lintable files touched by this task. If ESLint can auto-fix any touched `.ts` file, rerun the same command with `--fix` before editing by hand. If `server/src/ingest/embeddingDispatcher.ts` is not created, remove it from the command when running it.
11. [x] Run `npx prettier --check server/src/ingest/ingestJob.ts server/src/ingest/embeddingDispatcher.ts server/src/test/support/mockLmStudioSdk.ts server/src/test/unit/ingest-dispatcher.test.ts server/src/test/unit/ingest-cancel.test.ts server/src/test/features/ingest-embedding-dispatch.feature server/src/test/steps/ingest-embedding-dispatch.steps.ts server/src/test/features/ingest-cancel.feature server/src/test/steps/ingest-manage.steps.ts e2e/fixtures/repo/large-planning-doc.md`. The pass condition is that every touched file is already formatted. If Prettier reports differences, rerun against the same touched files with `npx prettier --write` before manual formatting edits. If `server/src/ingest/embeddingDispatcher.ts` is not created, remove it from the command when running it.

#### Testing

1. [x] Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-dispatcher.test.ts` and confirm the slot-driven dispatch, ordering, bounded queue, and large-file overlap proofs pass.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-cancel.test.ts` and confirm the cancel plus late-result fencing proofs pass.
4. [x] Run `npm run test:summary:server:cucumber -- --feature server/src/test/features/ingest-embedding-dispatch.feature` and confirm the slot-refill / bounded-dispatch integration proof passes.
5. [x] Run `npm run test:summary:server:cucumber -- --feature server/src/test/features/ingest-cancel.feature` and confirm the cancel / ignored-late-result integration proof passes.
#### Implementation notes

- Subtask 1: Re-read the Story 54 runtime requirements and inspected the current serial ingest loop, cancel path, LM Studio harness, Cucumber features, and e2e fixture mount so the dispatcher work starts from the real orchestration and proof seams.
- Subtask 2: Extracted `server/src/ingest/embeddingDispatcher.ts`, switched `ingestJob.ts` to stream chunks through slot-driven provider dispatch, applied the absolute queue cap on top of derived queue capacity, and preserved ordered persistence by sequence instead of request completion order.
- Subtask 3: Wired cancel through the active dispatcher map so new dispatch stops immediately, in-flight provider work gets abort signals where supported, and late results log `DEV-0000054:embedding_result_ignored_after_cancel` instead of writing after cancel.
- Subtask 4: Extended the LM Studio test support with controlled embedding calls and added dedicated Cucumber step files so dispatcher slot refill, queue pressure, cancel-after-dispatch, and late-result fencing can be driven deterministically instead of with timing sleeps.
- Subtask 5: Added the checked-in proof artifact `e2e/fixtures/repo/large-planning-doc.md` and kept it above the `65536` byte threshold so `/fixtures/repo/large-planning-doc.md` exercises the large-text route in automated and manual validation.
- Subtask 6: Added `server/src/test/unit/ingest-dispatcher.test.ts` to cover slot refill, bounded waiting work, deterministic mixed-file ordering, and overlap between large-text chunk production and first dispatch.
- Subtask 7: Expanded `server/src/test/unit/ingest-cancel.test.ts` beyond router coverage so it now exercises real ingest cancellation, verifies dispatch stops after cancel, and proves late provider results are ignored.
- Subtask 8: Added `server/src/test/features/ingest-embedding-dispatch.feature` with dedicated step bindings so the integration proof now targets dispatcher-slot behavior directly and checks for the Story 54 slot-refill marker.
- Subtask 9: Extended the cancel feature and manage steps so integration coverage now waits for a controlled in-flight provider request, cancels the run, releases the late result, and asserts the ignored-result marker is emitted.
- Subtask 10: ESLint needed one `--fix` import-order pass plus a follow-up manual cleanup for an unused `chunkText` import in `ingestJob.ts`, and then the exact Task 3 lint command passed with zero warnings.
- Subtask 11: Prettier reformatted the new dispatcher, unit tests, step files, and large markdown fixture; `.feature` files still need `prettier-plugin-gherkin` in this repo, so I used a temporary `npm install --no-save` plugin pass and then reran the full Task 3 check successfully.
- Testing 1: `npm run build:summary:server` passed with `agent_action: skip_log`, so the dispatcher refactor and new proof files compile in the server workspace.
- Testing 2: `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-dispatcher.test.ts` initially exposed a hanging overlap proof, so I tightened the test to pause on the third large-text block by content instead of call count; the rerun then passed with 3/3 tests green.
- Testing 3: `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-cancel.test.ts` first showed that the LM Studio wrapper aborted before a synthetic late result could reach the fence, so I moved the late-result proof to a deterministic dispatcher-level case in the same file and the rerun then passed with 4/4 tests green.
- Testing 4: `npm run test:summary:server:cucumber -- --feature server/src/test/features/ingest-embedding-dispatch.feature` first revealed another always-on step harness was resetting LM Studio in-flight back to `1`; I overrode the dispatch env inside the feature step itself and the rerun then passed with the slot-refill marker scenario green.
- Testing 5: `npm run test:summary:server:cucumber -- --feature server/src/test/features/ingest-cancel.feature` exposed two real cancel-path issues during the loop: cancel metadata was still willing to trigger a fresh embedding-dimension probe, and one shared cleanup hook needed to treat missing Chroma collections as a no-op. After fixing both, the rerun passed with the late-result marker scenario green.
- Update it during implementation with concise notes describing what was done, what issues were encountered, and what decisions were made.
- If a blocker is found during implementation, record the exact subtask or testing step, what was attempted, and what capability is missing.

---

### Task 4. Replace Partial Delta AST Updates With An AST-Relevance Gate And Full-Rebuild Reuse

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1, Task 3`
- Task Status: `__done__`
- Git Commits:
  - `797e87aa` `DEV-[54] - Add AST delta rebuild gate`

#### Overview

This task narrows AST work during delta re-embed without introducing incremental AST persistence complexity. It must explicitly skip AST work when the delta only touches non-AST files, and it must deliberately reuse the current full AST rebuild path whenever the delta includes any AST-supported add, change, delete, or move-across-boundary case.

#### Task Exit Criteria

- Delta re-embed now decides AST work through one explicit `astRelevantDelta` rule: non-AST-only deltas skip AST entirely, while any AST-relevant delta triggers the existing full rebuild path.
- The old changed-path-only AST delete/upsert behavior is removed from delta re-embed, the no-op and deletions-only vector fast paths stay coherent, and the new AST mode is proved by unit and Cucumber coverage plus the Story 54 AST proof marker.

#### Documentation Locations

- Mongoose `Model.bulkWrite()` docs: https://mongoosejs.com/docs/api/model.html#Model.bulkWrite() . Use this to keep the full-rebuild persistence path aligned with the existing bulk-write model rather than inventing ad hoc AST writes.
- Mongoose `Model.deleteMany()` docs: https://mongoosejs.com/docs/api/model.html#Model.deleteMany() . Use this when replacing the old delta-path AST delete behavior with the conservative skip-or-full-rebuild rule.

#### Subtasks

1. [x] Read the Story 54 Description, Acceptance Criteria, Edge Cases, Decisions, and Out Of Scope section, then inspect `server/src/ingest/ingestJob.ts`, `server/src/ingest/deltaPlan.ts`, `server/src/ast/parser.ts`, `server/src/test/unit/ingest-ast-indexing.test.ts`, `server/src/test/unit/ingest-delta-plan.test.ts`, `server/src/test/features/ingest-delta-reembed.feature`, and `server/src/test/steps/ingest-delta-reembed.steps.ts` so the AST change reuses the current full rebuild path instead of inventing partial AST logic.
2. [x] Update the delta re-embed decision logic in `server/src/ingest/ingestJob.ts` (and extract a small helper if it makes the logic clearer) so AST work is decided separately from generic vector delta work. When the delta contains no AST-supported add/change/delete, skip AST entirely and log `DEV-0000054:delta_ast_mode_selected` with `ast_skip_non_ast_delta`; when the delta contains any AST-supported add/change/delete, including delete-plus-add moves and moves across the AST-supported boundary, clear and rebuild the full AST using the existing full-rebuild persistence path instead of per-path partial updates.
3. [x] Remove or replace the old delta-path AST changed/deleted-path write logic in `server/src/ingest/ingestJob.ts` so the runtime no longer performs partial AST updates during delta re-embed. Preserve the current vector-side no-op and deletions-only fast paths where they still apply, and make sure the new AST rule does not claim “no changes” when only non-AST files were deleted.
4. [x] Update `server/src/test/unit/ingest-ast-indexing.test.ts` to prove the requirements “a delta with no AST-supported add / change / delete skips AST entirely” and “a delta with AST-supported changes reuses the existing full AST rebuild path” against the implementation owned by `server/src/ingest/ingestJob.ts`.
5. [x] Create `server/src/test/unit/ingest-ast-delta-mode.test.ts` to prove the requirement “AST-supported delete-plus-add moves, including moves across the AST-supported boundary, are treated as AST-relevant and therefore choose full rebuild mode” against the implementation owned by `server/src/ingest/ingestJob.ts` and any helper extracted for AST relevance calculation.
6. [x] Update `server/src/test/features/ingest-delta-reembed.feature` and `server/src/test/steps/ingest-delta-reembed.steps.ts` to prove the integration-level invariants “non-AST-only delta re-embed skips AST,” “AST-relevant delta re-embed performs full rebuild,” and “the runtime emits `DEV-0000054:delta_ast_mode_selected` with the correct mode.” If any scenario title still implies partial AST updates remain supported, rename that scenario when you update the proof.
7. [x] Run `npx eslint server/src/ingest/ingestJob.ts server/src/ingest/deltaPlan.ts server/src/test/unit/ingest-ast-indexing.test.ts server/src/test/unit/ingest-ast-delta-mode.test.ts server/src/test/steps/ingest-delta-reembed.steps.ts --max-warnings=0`. The pass condition is zero ESLint errors and zero warnings for the touched `.ts` files. If ESLint can auto-fix any `.ts` file, rerun the same command with `--fix` before making manual style edits.
8. [x] Run `npx prettier --check server/src/ingest/ingestJob.ts server/src/ingest/deltaPlan.ts server/src/test/unit/ingest-ast-indexing.test.ts server/src/test/unit/ingest-ast-delta-mode.test.ts server/src/test/features/ingest-delta-reembed.feature server/src/test/steps/ingest-delta-reembed.steps.ts`. The pass condition is that every touched file is already formatted. If Prettier reports differences, rerun the same file list with `npx prettier --write` before manual formatting edits.

#### Testing

1. [x] Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-ast-indexing.test.ts` and confirm the AST skip-versus-full-rebuild proofs pass.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-ast-delta-mode.test.ts` and confirm the AST-relevance move / cross-boundary proofs pass.
4. [x] Run `npm run test:summary:server:cucumber -- --feature server/src/test/features/ingest-delta-reembed.feature` and confirm the delta re-embed integration proof passes with the new AST rule.

#### Implementation notes

- Subtask 1: Re-read the Story 54 AST requirements and inspected the current delta planner, AST parser entrypoint, delta re-embed orchestration, and existing unit/Cucumber proof files so Task 4 can replace the partial AST path instead of layering another mode on top of it.
- Subtask 2: Added `resolveDeltaAstMode` in `server/src/ingest/deltaPlan.ts` and wired `server/src/ingest/ingestJob.ts` to log `DEV-0000054:delta_ast_mode_selected`, skip AST for non-AST-only deltas, and force the existing full AST clear-and-rebuild path whenever any AST-supported add/change/delete is present.
- Subtask 3: Removed the old relPath-scoped AST delete/update branch from delta re-embed and kept the vector fast paths only where they still hold, so non-AST deletions-only runs stay lightweight while AST-relevant deletions fall through to a full rebuild instead of partial AST mutation.
- Subtask 4: Reworked `server/src/test/unit/ingest-ast-indexing.test.ts` so the delta AST proofs now cover AST skip mode, AST full rebuild mode, and AST-relevant deletions without relying on the removed relPath-scoped delete branch.
- Subtask 5: Added `server/src/test/unit/ingest-ast-delta-mode.test.ts` to lock in the Story 54 move semantics, including supported-to-supported and cross-boundary delete-plus-add cases that must still force a full rebuild.
- Subtask 6: Extended the delta re-embed Cucumber feature and step definitions with AST coverage timestamp checks and `DEV-0000054:delta_ast_mode_selected` assertions so the integration proof distinguishes non-AST skip mode from AST full rebuild mode.
- Subtask 7: `npx eslint server/src/ingest/ingestJob.ts server/src/ingest/deltaPlan.ts server/src/test/unit/ingest-ast-indexing.test.ts server/src/test/unit/ingest-ast-delta-mode.test.ts server/src/test/steps/ingest-delta-reembed.steps.ts --max-warnings=0` passed cleanly without needing an auto-fix rerun.
- Subtask 8: `npx prettier --check ... --plugin prettier-plugin-gherkin` passed after a single `--write` pass on the touched files; the Gherkin plugin was required so Prettier could parse `server/src/test/features/ingest-delta-reembed.feature`.
- Testing 1: `npm run build:summary:server` passed with `agent_action: skip_log`, confirming the AST delta-mode changes still compile cleanly through the repo wrapper.
- Testing 2: `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-ast-indexing.test.ts` passed with 17/17 tests green, including the updated skip-versus-full-rebuild assertions and the AST-relevant deletions proof.
- Testing 3: `npm run test:summary:server:unit -- --file server/src/test/unit/ingest-ast-delta-mode.test.ts` passed with 4/4 tests green, covering supported-file moves and cross-boundary delete-plus-add cases.
- Testing 4: `npm run test:summary:server:cucumber -- --feature server/src/test/features/ingest-delta-reembed.feature` passed with 13/13 scenarios green, including the new marker-backed proof that non-AST deltas skip AST while AST-relevant deletions trigger full rebuild mode.
- Update it during implementation with concise notes describing what was done, what issues were encountered, and what decisions were made.
- If a blocker is found during implementation, record the exact subtask or testing step, what was attempted, and what capability is missing.

---

### Task 5. Validate Story 54 End To End And Update Operator-Facing Documentation

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1, Task 2, Task 3, Task 4`
- Task Status: `__done__`
- Git Commits:
  - `31085fa0` - `DEV-[54] - Progress story 54 validation`
  - `f1552971` - `DEV-[54] - Finish story 54 validation`
- Notes: This final validation task normally depends on all earlier tasks required for final story proof.

#### Overview

This final task proves the story as one coherent runtime change rather than as isolated code edits. It must validate the Acceptance Criteria through the repository’s wrapper-first workflow, document the new env knobs and delta AST behavior for operators, and run one reproducible large-file ingest scenario that confirms the new large-text and dispatcher markers in the real runtime path.

#### Task Exit Criteria

- Every in-scope Story 54 behavior is implemented, documented, and proved through the repo’s standard wrappers plus one reproducible large-file runtime check.
- README guidance, checked-in env defaults, and final proof steps all reflect the finished runtime behavior without claiming any out-of-scope benchmark SLA or partial AST feature.

#### Documentation Locations

- OpenAI embeddings guide: https://platform.openai.com/docs/guides/embeddings . Use this when validating that the final batching behavior still matches the supported embeddings flow.
- Playwright test documentation: https://playwright.dev/docs/test-intro . Use this for the existing browser proof path when updating or validating `e2e/ingest.spec.ts`.
- MDN AbortController / AbortSignal documentation: https://developer.mozilla.org/en-US/docs/Web/API/AbortController . Use this when validating cancel semantics in the final runtime proof.

#### Subtasks

1. [x] Re-read the full story in `planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md` and trace every Acceptance Criterion, important Description requirement, proof marker, and explicit Out Of Scope boundary back to the completed outputs from Task 1 through Task 4. Record that coverage directly in Task 5 Implementation notes so final validation proves the whole story without relying on tribal knowledge or vague “manual checking.”
2. [x] Update `README.md` in its own documentation subtask so operators can discover the new large-text threshold, provider-specific batching and max-in-flight env vars, absolute queue-cap behavior, cancellation expectations, and the refined delta AST rebuild rule from the main repository docs. Keep the README text honest about scope: no benchmark SLA, no new ingest API, no partial AST updates.
3. [x] Update `e2e/ingest.spec.ts` and the checked-in proof artifact `e2e/fixtures/repo/large-planning-doc.md` to prove the final browser-visible invariant “the existing ingest UI still completes a reproducible large-text ingest flow without a new surface.” Keep this browser proof in the final validation task rather than in the lower-level server tasks, use the mounted runtime path `/fixtures/repo/large-planning-doc.md` inside the test flow, and give the Playwright case a title that explicitly names large-text ingest instead of reusing a generic happy-path title.
4. [x] Update the proof artifact comments or nearby documentation in `e2e/fixtures/repo/large-planning-doc.md` and `e2e/ingest.spec.ts` so the final proof obligation “one reproducible large-file scenario exists and is intentionally part of Story 54 validation” is visible in the artifact itself rather than remaining tribal knowledge.
5. [x] Record the final proof artifacts for this story in Task 5 Implementation notes as they are produced: the wrapper commands that passed, the checked-in fixture path `e2e/fixtures/repo/large-planning-doc.md`, the mounted runtime path `/fixtures/repo/large-planning-doc.md`, and the runtime markers observed (`DEV-0000054:large_text_path_selected`, `DEV-0000054:embedding_dispatch_slot_filled`, and the AST or cancel marker relevant to the run). This keeps the end-to-end proof traceable after the wrapper pass finishes.

#### Testing

1. [x] Run `npm run compose:build:summary` and confirm the wrapper finishes successfully without `agent_action: inspect_log`.
2. [x] Run `npm run test:summary:server:unit` and confirm the full server unit suite passes.
3. [x] Run `npm run test:summary:server:cucumber` and confirm the full server Cucumber/Testcontainers suite passes.
4. [x] Run `npm run test:summary:e2e` and confirm the end-to-end ingest suite passes on the existing ingest UI flow.
5. [x] Run `npm run compose:up` so the main runtime stack is available for one manual large-file proof run against the standard ingest path. The build was already covered by `npm run compose:build:summary` in Testing step 1.
6. [x] Perform one manual Playwright MCP validation against the existing `/ingest` UI using the mounted fixture path `/fixtures/repo/large-planning-doc.md`, and confirm the runtime evidence includes `DEV-0000054:large_text_path_selected`, `DEV-0000054:embedding_dispatch_slot_filled`, and the expected cancel or AST marker for the path being exercised.
7. [x] Run `npm run compose:down` after the manual Playwright MCP validation completes.

#### Implementation notes

- Subtask 1: Re-read the full Story 54 plan and traced the current proof coverage back to completed work: Task 1 owns file-size discovery, the large-text threshold, and `DEV-0000054:large_text_path_selected`; Task 2 owns provider batch/max-in-flight config and contract clamps; Task 3 owns slot-driven dispatch, bounded queueing, `/fixtures/repo/large-planning-doc.md`, `DEV-0000054:embedding_dispatch_slot_filled`, and cancel late-result fencing; Task 4 owns the delta AST skip-or-full-rebuild rule and `DEV-0000054:delta_ast_mode_selected`. The remaining gap is final documentation plus one compose-backed browser/runtime proof that exercises those finished paths together without expanding scope into new runtime behavior.
- Subtask 2: Added a Story 54 README section that documents the checked-in large-text threshold, provider-specific batching and max-in-flight knobs, queue-cap semantics, cancellation expectations, and the final conservative delta AST rule without claiming a new API surface or benchmark SLA.
- Subtask 3: Reworked `e2e/ingest.spec.ts` so the browser proof explicitly targets the mounted large-file path `/fixtures/repo/large-planning-doc.md`, waits for the active ingest panel to reach `large-planning-doc.md`, and checks the runtime markers instead of relying on a generic happy-path title and completion row alone.
- Subtask 4: Strengthened the checked-in artifact comments in `e2e/fixtures/repo/large-planning-doc.md` and the nearby e2e test comment so the Story 54 large-file proof remains visible in the artifact and test source instead of only in the planning document.
- Testing 1: `npm run compose:build:summary` passed with `agent_action: skip_log`, confirming the compose-backed runtime images still build cleanly with the Story 54 docs and e2e proof updates in place.
- Testing 2: `npm run test:summary:server:unit` passed with 1542/1542 tests green and `agent_action: skip_log`, so the full server unit and integration suite stayed clean after the Story 54 close-out docs and browser-proof updates.
- Testing 3: `npm run test:summary:server:cucumber` passed with 80/80 tests green after keeping `clearLockedModel()` tolerant of already-missing Chroma collections and aligning the controlled LM Studio embedding fixture with the shared 1D Chroma test environment used across the suite.
- Testing 4: `e2e/chat-tools.spec.ts` was consuming the default `30_000 ms` Playwright test budget inside `waitForIngest()` before it ever navigated to `/chat`, so I applied the same explicit compose-backed timeout pattern already used in `e2e/ingest.spec.ts` to the `shows vector search citation with host path` case. The targeted rerun passed, and the full `npm run test:summary:e2e` wrapper then completed with `expected: 54`, `unexpected: 0`, and `flaky: 0` in `logs/test-summaries/e2e-tests-latest.log`.
- Testing 5: `npm run compose:up` completed cleanly and brought the main stack up on the expected host-visible ports, so the final manual `/ingest` proof can run against `http://host.docker.internal:5001` and `http://host.docker.internal:5010`.
- Subtask 5: Recorded the final Story 54 proof artifacts from the completed wrapper and manual runs: passed wrappers `npm run compose:build:summary`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, and `npm run test:summary:e2e`; checked-in fixture `[e2e/fixtures/repo/large-planning-doc.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/e2e/fixtures/repo/large-planning-doc.md)`; mounted runtime path `/fixtures/repo/large-planning-doc.md`; manual ingest run `6683764b-c33b-4e8b-b92a-50502e91b018`; manual re-embed run `95fff02e-29fa-4410-ab73-7abf32c15f0c`; observed markers `DEV-0000054:large_text_path_selected`, `DEV-0000054:embedding_dispatch_slot_filled`, and `DEV-0000054:delta_ast_mode_selected` with `mode=ast_skip_non_ast_delta` after a real non-AST delta was introduced in the running fixture before browser-triggered re-embed.
- Testing 6: Manual Playwright MCP validation passed against `http://host.docker.internal:5001/ingest`. The browser ingest run completed for `/fixtures/repo`, the active run visibly reached `large-planning-doc.md`, and the server logs for run `6683764b-c33b-4e8b-b92a-50502e91b018` and re-embed run `95fff02e-29fa-4410-ab73-7abf32c15f0c` showed `DEV-0000054:large_text_path_selected`, `DEV-0000054:embedding_dispatch_slot_filled`, and `DEV-0000054:delta_ast_mode_selected` with `ast_skip_non_ast_delta`.
- Testing 7: `npm run compose:down` completed cleanly after the manual Playwright MCP proof, returning the main stack to a stopped state so the story closes without leaving shared runtime services running.
- Record final validation outcomes, important proof artifacts, documentation updates, and any final decisions made during story close-out.

## Questions

- No Further Questions

## Code Review Findings

Story 54 is reopened because the review found three `must_fix` cancellation-path defects in the current repository. The durable review artifacts for this reopen decision are:

- Evidence: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-evidence.md)
- Findings: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md)
- Blind-spot challenge: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-blind-spot-challenge.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-blind-spot-challenge.md)

The review findings that must be fixed before Story 54 can stay complete are:

1. Post-production cancellation can deadlock the ingest worker if queued embedding work still exists when cancel lands.
2. The late-result fence still allows cancelled runs to persist vectors if cancel lands after `embedBatch()` resolves but before ordered persistence finishes.
3. The exported cancel route can still trigger a fresh embedding-dimension probe after cancel if collection-dimension lookup falls back to `null`.

The follow-up tasks below keep repository ownership explicit, fix only the reviewed defects, and end with a full Story 54 revalidation pass against the acceptance criteria.

---

### Task 6. Fix Post-Production Cancel Deadlock In The Dispatcher And Ingest Worker

- Repository Name: `Current Repository`
- Task Dependencies: `Task 3`
- Task Status: `__done__`
- Git Commits:
  - `7a201e65` - `DEV-[54] - Fix post-production cancel deadlock`

#### Overview

This task fixes the cancellation defect where Story 54's slot-driven dispatcher can leave queued work stranded after production is already complete, which in turn leaves `processRun(...)` blocked in `waitForIdle()`. The fix must keep the dispatcher bounded and provider-aware, but it must also guarantee that cancellation always drives the dispatcher to a terminal state even when queued work still exists behind aborted in-flight requests.

#### Task Exit Criteria

- Cancelling after `dispatcher.completeProduction()` but before all queued work has drained no longer leaves `processRun(...)` blocked in `waitForIdle()`.
- Dispatcher cancel semantics explicitly decide what happens to queued-but-not-yet-dispatched work and make that terminal state observable to the caller instead of depending on a happy-path drain.
- The fix is proved by direct unit coverage for the post-production cancel window and by existing cancel-path integration coverage still passing afterward.

#### Documentation Locations

- Story 54 findings artifact: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md)

#### Subtasks

1. [x] Re-read the Story 54 cancellation acceptance criteria plus the review findings and blind-spot challenge, then inspect `server/src/ingest/embeddingDispatcher.ts`, `server/src/ingest/ingestJob.ts`, `server/src/test/unit/ingest-dispatcher.test.ts`, `server/src/test/unit/ingest-cancel.test.ts`, and `server/src/test/features/ingest-cancel.feature` so the fix targets the exact post-production cancel gap instead of changing unrelated dispatch behavior.
2. [x] Update `server/src/ingest/embeddingDispatcher.ts` so `cancel()` drives the dispatcher to a true terminal state even when queued work still exists. The implementation must make a clear decision for queued-but-not-yet-dispatched items, ensure `waitForIdle()` can resolve after cancel, and preserve the existing bounded queue and slot-refill behavior for non-cancelled runs.
3. [x] Update `server/src/ingest/ingestJob.ts` so the Story 54 ingest worker can always reach its cancellation cleanup path after production has completed, even if cancel lands while queued work is still pending behind aborted provider requests.
4. [x] Add or extend direct unit coverage in `server/src/test/unit/ingest-dispatcher.test.ts` to prove the exact reviewed failure mode: cancel after `completeProduction()` with queued work still present must not deadlock `waitForIdle()`.
5. [x] Extend `server/src/test/unit/ingest-cancel.test.ts` so the higher-level Story 54 cancel proof covers the post-production cancel window in addition to the existing cancel-before-result path.
6. [x] Update `server/src/test/features/ingest-cancel.feature` only if the existing integration proof needs one focused scenario to show that the API-visible cancel path still reaches a single terminal cancelled outcome after the post-production window is exercised.
7. [x] Run `npx eslint server/src/ingest/embeddingDispatcher.ts server/src/ingest/ingestJob.ts server/src/test/unit/ingest-dispatcher.test.ts server/src/test/unit/ingest-cancel.test.ts --max-warnings=0`. The pass condition is zero ESLint errors and zero warnings for the touched `.ts` files. If ESLint can auto-fix any `.ts` file, rerun the same command with `--fix` before making manual style edits.
8. [x] Run `npx prettier --check server/src/ingest/embeddingDispatcher.ts server/src/ingest/ingestJob.ts server/src/test/unit/ingest-dispatcher.test.ts server/src/test/unit/ingest-cancel.test.ts server/src/test/features/ingest-cancel.feature`. The pass condition is that every touched file is already formatted. If Prettier reports differences, rerun the same file list with `npx prettier --write` before manual formatting edits.

#### Testing

1. [x] Do not run build or test commands directly for this task. Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/build-server-latest.log` if the wrapper reports failure, unexpected warnings, or an ambiguous result.
2. [x] Do not run narrow server tests first for this task. Run `npm run test:summary:server:unit` and confirm the server unit wrapper passes for the Task 6 cancel and dispatcher changes. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands for `server/src/test/unit/ingest-dispatcher.test.ts` and `server/src/test/unit/ingest-cancel.test.ts`, then rerun full `npm run test:summary:server:unit`.
3. [x] Do not run the Cucumber feature directly as the primary proof for this task. Run `npm run test:summary:server:cucumber` and confirm the API-visible cancel path still reaches one terminal cancelled outcome after the Task 6 fix. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands for `server/src/test/features/ingest-cancel.feature`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read the Story 54 cancellation acceptance criteria, the review findings, and the blind-spot challenge, then inspected the dispatcher idle/cancel path, the ingest worker wait-for-idle flow, the current cancel tests, and the existing cancel feature so Task 6 stays focused on the post-production deadlock window.
- Subtask 2: Updated `createEmbeddingDispatcher().cancel()` to treat queued-but-not-yet-dispatched work as dropped on cancel, which lets `waitForIdle()` resolve once any already-started requests unwind without changing non-cancelled queue behavior.
- Subtask 3: The ingest worker’s existing `completeProduction() -> waitForIdle() -> handleCancellation()` flow now reaches cleanup in the post-production window because the dispatcher no longer strands queued items after cancel; no separate ingest-worker branch was needed once the terminal dispatcher state was fixed.
- Subtask 4: Added a dispatcher-level unit proof that cancels after `completeProduction()` with one item still queued and confirms `waitForIdle()` resolves instead of hanging.
- Subtask 5: Extended the higher-level cancel unit coverage to start a real ingest, wait until production has queued the second chunk, cancel in that post-production window, and assert the run still reaches a single terminal `cancelled` outcome without dispatching the queued item.
- Subtask 6: Kept `server/src/test/features/ingest-cancel.feature` unchanged because the existing API-visible cancel feature is still the right proof surface; Task 6 will rely on the required full Cucumber wrapper run to confirm that behavior stays green after the dispatcher fix.
- Subtask 7: `npx eslint server/src/ingest/embeddingDispatcher.ts server/src/ingest/ingestJob.ts server/src/test/unit/ingest-dispatcher.test.ts server/src/test/unit/ingest-cancel.test.ts --max-warnings=0` passed cleanly for the Task 6 file set.
- Subtask 8: Prettier needed one `--write` pass on `server/src/ingest/ingestJob.ts` and `server/src/test/unit/ingest-cancel.test.ts`, and the final `--check` passed with `prettier-plugin-gherkin` supplied for `server/src/test/features/ingest-cancel.feature`.
- Testing 1: `npm run build:summary:server` initially failed on a mistaken `running` state assertion in the new cancel proof, so I corrected it to the real `embedding` state and reran the wrapper; the rerun passed with `agent_action: skip_log`.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with 1545/1545 tests green and `agent_action: skip_log`, so the post-production cancel fix did not require a targeted wrapper fallback.
- Testing 3: `npm run test:summary:server:cucumber` passed cleanly with 80/80 tests green and `agent_action: skip_log`, confirming the API-visible cancel scenarios still converge on one terminal cancelled outcome after the dispatcher terminal-state fix.
- Update this section during implementation with concise notes describing what was done, what issues were encountered, and what decisions were made.
- If a blocker is found during implementation, record the exact subtask or testing step, what was attempted, and what capability is missing.

---

### Task 7. Fence Cancelled Results Before Ordered Persistence Writes

- Repository Name: `Current Repository`
- Task Dependencies: `Task 3, Task 6`
- Task Status: `__done__`
- Git Commits:
  - `1fb0849f` - `DEV-[54] - Fence cancelled ordered persistence writes`

#### Overview

This task closes the reviewed race where cancellation can land after `embedBatch()` returns but before Story 54's ordered persistence buffer finishes writing vectors. The fix must ensure that a cancelled run cannot write new vectors or chunk metadata after cancellation cleanup has started, even when a provider result is already in hand.

#### Task Exit Criteria

- Story 54's late-result fence now covers the `embedBatch() resolved but onCompleted()/queuePersist() not finished yet` gap.
- Cancel cleanup and ordered persistence no longer race in a way that can leave stray vectors or chunk metadata for a cancelled run.
- Direct unit proof exists for the reviewed race rather than only the simpler cancel-before-result case.

#### Documentation Locations

- Story 54 findings artifact: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md)

#### Subtasks

1. [x] Re-read the Story 54 cancellation acceptance criteria and the review findings, then inspect `server/src/ingest/embeddingDispatcher.ts`, `server/src/ingest/ingestJob.ts`, `server/src/test/unit/ingest-cancel.test.ts`, and `server/src/test/features/ingest-cancel.feature` so the fix targets the exact `cancel-after-result-before-persist` race.
2. [x] Update `server/src/ingest/embeddingDispatcher.ts` and/or `server/src/ingest/ingestJob.ts` so a cancelled run cannot move provider results into the pending ordered-persistence path after cancel cleanup starts. The chosen fence must be explicit, deterministic, and local to the Story 54 ordered-persistence design rather than relying on timing.
3. [x] Ensure the fix keeps deterministic sequence ordering for non-cancelled runs and does not broaden scope into unrelated persistence refactors.
4. [x] Add direct unit coverage in `server/src/test/unit/ingest-cancel.test.ts` for the exact reviewed race: cancel after provider result resolution but before ordered persistence completes must not write vectors for the cancelled run.
5. [x] Extend `server/src/test/unit/ingest-dispatcher.test.ts` only if one focused lower-level case is needed to prove the dispatcher-side portion of the fence separately from the ingest worker.
6. [x] Update `server/src/test/features/ingest-cancel.feature` only if the integration proof needs one focused marker-backed scenario that shows cancelled runs do not persist late results after cleanup starts.
7. [x] Run `npx eslint server/src/ingest/embeddingDispatcher.ts server/src/ingest/ingestJob.ts server/src/test/unit/ingest-cancel.test.ts server/src/test/unit/ingest-dispatcher.test.ts --max-warnings=0`. The pass condition is zero ESLint errors and zero warnings for the touched `.ts` files. If ESLint can auto-fix any `.ts` file, rerun the same command with `--fix` before making manual style edits.
8. [x] Run `npx prettier --check server/src/ingest/embeddingDispatcher.ts server/src/ingest/ingestJob.ts server/src/test/unit/ingest-cancel.test.ts server/src/test/unit/ingest-dispatcher.test.ts server/src/test/features/ingest-cancel.feature`. The pass condition is that every touched file is already formatted. If Prettier reports differences, rerun the same file list with `npx prettier --write` before manual formatting edits.

#### Testing

1. [x] Do not run build or test commands directly for this task. Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/build-server-latest.log` if the wrapper reports failure, unexpected warnings, or an ambiguous result.
2. [x] Do not run narrow server tests first for this task. Run `npm run test:summary:server:unit` and confirm the server unit wrapper passes for the Task 7 cancel-after-result-before-persist fix. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands for `server/src/test/unit/ingest-cancel.test.ts` and `server/src/test/unit/ingest-dispatcher.test.ts` when those proofs fail, then rerun full `npm run test:summary:server:unit`.
3. [x] Do not run the Cucumber feature directly as the primary proof for this task. Run `npm run test:summary:server:cucumber` if Task 7 changed any feature or step coverage, and confirm cancelled runs still avoid late writes in the API-visible path. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with a targeted wrapper command for `server/src/test/features/ingest-cancel.feature`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read the Story 54 cancellation acceptance criteria and review findings, then inspected the dispatcher completion hook, ordered persistence chain, cancel cleanup path, and existing cancel proofs so Task 7 stays focused on the `embedBatch() resolved but persist not finished yet` race.
- Subtask 2: Added a cancel-cleanup fence inside `server/src/ingest/ingestJob.ts` so pending ordered results and staged vector batches are cleared once cleanup starts, and any in-flight persistence chain is awaited before cancel cleanup deletes vectors.
- Subtask 3: Kept the normal sequence-based ordering path intact for non-cancelled runs by only activating the new fence when cancellation cleanup has begun, rather than changing the steady-state ordered persistence flow.
- Subtask 4: Added a direct ingest-level unit proof that blocks `vectors.add()`, cancels after provider results are already resolved, then confirms the cancelled run finishes without leaving stored vectors behind after the blocked persist resumes.
- Subtask 5: Left `server/src/test/unit/ingest-dispatcher.test.ts` unchanged because the reviewed race is owned by the ingest worker’s ordered persistence fence, and the new direct ingest-level proof already covers that exact window.
- Subtask 6: Kept `server/src/test/features/ingest-cancel.feature` unchanged for now because Task 7 has not introduced a new API-visible surface; the wrapper-first validation step will confirm whether the existing feature coverage remains sufficient.
- Subtask 7: `npx eslint server/src/ingest/embeddingDispatcher.ts server/src/ingest/ingestJob.ts server/src/test/unit/ingest-cancel.test.ts server/src/test/unit/ingest-dispatcher.test.ts --max-warnings=0` passed cleanly for the Task 7 file set.
- Subtask 8: Prettier needed one `--write` pass on `server/src/test/unit/ingest-cancel.test.ts`, and the final `--check` passed with `prettier-plugin-gherkin` supplied for `server/src/test/features/ingest-cancel.feature`.
- Testing 1: `npm run build:summary:server` passed cleanly on the wrapper path before and after the final fence adjustments, so the ordered-persistence fix compiles through the normal server build flow.
- Testing 2: The first full `npm run test:summary:server:unit` run exposed that the original fence still allowed one vector to survive when cancel landed during an in-flight `vectors.add()`, so I added a post-write id-based delete plus a settle-aware assertion in the direct race proof and reran the wrapper. The final rerun passed with 1546/1546 tests green and `agent_action: skip_log`.
- Testing 3: The first full `npm run test:summary:server:cucumber` run exposed a Chroma cleanup regression because the post-write fence had been deleting by metadata filter inside the write path. Switching that fence to delete by the just-written vector ids fixed the cleanup path, and the final full wrapper rerun passed with 80/80 tests green and `agent_action: skip_log`.
- Update this section during implementation with concise notes describing what was done, what issues were encountered, and what decisions were made.
- If a blocker is found during implementation, record the exact subtask or testing step, what was attempted, and what capability is missing.

---

### Task 8. Remove Fresh Embedding Probes From The Exported Cancel Route Fallback Path

- Repository Name: `Current Repository`
- Task Dependencies: `Task 3`
- Task Status: `__done__`
- Git Commits:
  - `d377a19f` - `DEV-[54] - Remove cancel-route dimension probes`

#### Overview

This task fixes the reviewed cancel-route defect where Story 54 can still send a fresh embedding-dimension probe after cancellation if collection-dimension lookup falls back to `null`. The exported `cancelRun(...)` path used by `/ingest/cancel/:runId` must stay bounded and must not issue new provider work after a user has already cancelled the run.

#### Task Exit Criteria

- The exported `cancelRun(...)` path no longer triggers a fresh embedding request just to discover root dimensions after cancellation.
- If collection-dimension lookup cannot recover a usable dimension, the fallback behavior remains explicit and safe without hiding the condition behind a new provider call.
- Direct unit proof exists for the lookup-fails cancel path rather than only the happy path where dimensions are already known.

#### Documentation Locations

- Story 54 findings artifact: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md)

#### Subtasks

1. [x] Re-read the Story 54 cancellation acceptance criteria plus the review findings, then inspect `server/src/ingest/ingestJob.ts`, `server/src/routes/ingestCancel.ts`, and `server/src/test/unit/ingest-cancel.test.ts` so the fix targets the exported cancel-route fallback path rather than only the in-worker `handleCancellation(...)` helper.
2. [x] Update `server/src/ingest/ingestJob.ts` so the exported `cancelRun(...)` path never issues a fresh embedding probe after cancellation. If collection-dimension lookup fails, choose a bounded fallback that does not send new provider work and make that fallback explicit in code and logs.
3. [x] Keep the route contract in `server/src/routes/ingestCancel.ts` unchanged unless a review-proven contract change is unavoidable; this task should stay inside Story 54’s existing cancel API surface.
4. [x] Add direct unit coverage in `server/src/test/unit/ingest-cancel.test.ts` for the lookup-fails cancel path so the test proves no fresh embedding probe occurs after cancellation even when collection-dimension recovery does not succeed.
5. [x] Extend any existing cancel-route proof only as needed to show the `/ingest/cancel/:runId` path still returns cleanly after the bounded fallback change.
6. [x] Run `npx eslint server/src/ingest/ingestJob.ts server/src/routes/ingestCancel.ts server/src/test/unit/ingest-cancel.test.ts --max-warnings=0`. The pass condition is zero ESLint errors and zero warnings for the touched `.ts` files. If ESLint can auto-fix any `.ts` file, rerun the same command with `--fix` before making manual style edits.
7. [x] Run `npx prettier --check server/src/ingest/ingestJob.ts server/src/routes/ingestCancel.ts server/src/test/unit/ingest-cancel.test.ts`. The pass condition is that every touched file is already formatted. If Prettier reports differences, rerun the same file list with `npx prettier --write` before manual formatting edits.

#### Testing

1. [x] Do not run build or test commands directly for this task. Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/build-server-latest.log` if the wrapper reports failure, unexpected warnings, or an ambiguous result.
2. [x] Do not run narrow server tests first for this task. Run `npm run test:summary:server:unit` and confirm the server unit wrapper passes for the Task 8 lookup-fails cancel-path fix. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands for `server/src/test/unit/ingest-cancel.test.ts`, then rerun full `npm run test:summary:server:unit`.
3. [x] Do not run the Cucumber feature directly as the primary proof for this task. Run `npm run test:summary:server:cucumber` if Task 8 changed feature or route-visible cancel proof behavior, and confirm the API-visible cancel path still completes cleanly. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with a targeted wrapper command for `server/src/test/features/ingest-cancel.feature`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read the Story 54 cancellation acceptance criteria and review findings, then inspected the exported `cancelRun(...)` fallback path, the unchanged cancel route contract, and the current cancel unit proofs so Task 8 stays focused on the lookup-fails route path rather than the in-worker cancellation logic from Tasks 6 and 7.
- Subtask 2: Removed the exported `cancelRun(...)` fallback to `resolveRootEmbeddingDim(...)`; when dimension lookup still resolves to `<= 1` after cancellation, the route now uses an explicit bounded `dimension=1` fallback and logs that the no-probe cancel fallback path was used.
- Subtask 3: Kept `server/src/routes/ingestCancel.ts` unchanged because the fix stayed inside the exported cancel helper and did not require a route contract change.
- Subtask 4: Added direct unit coverage for the lookup-fails cancel path and proved that cancel still finishes cleanly while embedding-call count stays at one instead of issuing a second dimension-probe request.
- Subtask 5: Kept the existing route-visible cancel proof surface unchanged and left the wrapper-first validation step to confirm the `/ingest/cancel/:runId` path still completes cleanly with the bounded fallback.
- Subtask 6: ESLint initially flagged the new bounded-fallback dimension local as `prefer-const`; after the allowed `--fix` pass, the exact Task 8 lint command passed cleanly.
- Subtask 7: Prettier needed one `--write` pass on `server/src/test/unit/ingest-cancel.test.ts`, and the final `--check` passed cleanly for the Task 8 file set.
- Testing 1: `npm run build:summary:server` passed with `agent_action: skip_log`, so the cancel-route fallback change compiles cleanly through the normal server wrapper path.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with 1547/1547 tests green and `agent_action: skip_log`, proving the new lookup-fails cancel-path coverage without needing a targeted wrapper fallback.
- Testing 3: `npm run test:summary:server:cucumber` passed cleanly with 80/80 tests green and `agent_action: skip_log`, confirming the API-visible cancel path still completes cleanly after the bounded no-probe fallback change.
- Update this section during implementation with concise notes describing what was done, what issues were encountered, and what decisions were made.
- If a blocker is found during implementation, record the exact subtask or testing step, what was attempted, and what capability is missing.

---

### Task 9. Revalidate Story 54 After Code Review Fixes

- Repository Name: `Current Repository`
- Task Dependencies: `Task 6, Task 7, Task 8`
- Task Status: `__done__`
- Git Commits:
  - `881d16c9` - `DEV-[54] - Revalidate story 54 after review fixes`

#### Overview

This final revalidation task closes the reopened code-review loop for Story 54. It must prove that the review-fix tasks resolved the cancellation defects without regressing the already-finished large-text, provider-dispatch, AST delta-mode, and end-to-end validation behavior that Story 54 originally completed.

#### Task Exit Criteria

- The review findings are fixed, the durable review artifacts remain in history with the reopened plan, and Story 54 again satisfies its acceptance criteria through the repo’s wrapper-first validation flow.
- Revalidation explicitly proves both the original Story 54 behavior and the reopened cancellation-path fixes.

#### Documentation Locations

- Evidence: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-evidence.md)
- Findings: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-findings.md)
- Blind-spot challenge: [codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-blind-spot-challenge.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T043447Z-665f74d9-blind-spot-challenge.md)

#### Subtasks

1. [x] Re-read the full Story 54 plan plus the three review artifacts and trace every reopened review finding back to the fix delivered in Tasks 6 through 8, while also confirming that Tasks 1 through 5 still cover the original large-text, dispatcher, AST, and documentation scope.
2. [x] Update Task 9 Implementation notes as the revalidation proceeds so the final close-out explicitly records which acceptance criteria have direct proof, which still rely on indirect proof by design, and why no further review-fix tasks are needed.
3. [x] If any proof command fails during this revalidation task, capture the exact failure in the implementation notes and reopen the plan again only if a new review-fix task is genuinely required.

#### Testing

1. [x] Do not run build commands directly for this final validation task. Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/build-server-latest.log` if the wrapper reports failure, unexpected warnings, or an ambiguous result.
2. [x] Do not run client build commands directly for this final validation task. Run `npm run build:summary:client` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/build-client-latest.log` if the wrapper reports failure, unexpected warnings, or an ambiguous result.
3. [x] Do not run narrow server tests first for this final validation task. Run `npm run test:summary:server:unit` and confirm the full server unit wrapper passes with the review fixes in place. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands, then rerun full `npm run test:summary:server:unit`.
4. [x] Do not run narrow Cucumber features first for this final validation task. Run `npm run test:summary:server:cucumber` and confirm the full server Cucumber/Testcontainers wrapper passes with the review fixes in place. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands, then rerun full `npm run test:summary:server:cucumber`.
5. [x] Do not run client tests directly for this final validation task. Run `npm run test:summary:client` and confirm the client wrapper passes for the unchanged browser-facing regression surface. If `failed > 0`, inspect the exact `test-results/client-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands, then rerun full `npm run test:summary:client`.
6. [x] Do not run Playwright directly as the primary automated proof for this final validation task. Run `npm run test:summary:e2e` and allow up to 7 minutes for the wrapper to finish while it proves the existing ingest UI flow and Story 54 browser path. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted wrapper commands, then rerun full `npm run test:summary:e2e`.
7. [x] Run `npm run compose:build:summary` before manual runtime proof because this is the final regression task and the browser-visible path remains in scope. Confirm the wrapper finishes successfully without `agent_action: inspect_log`, and only open `logs/test-summaries/compose-build-latest.log` if the wrapper reports failure or an ambiguous result.
8. [x] Run `npm run compose:up` before manual validation so the standard runtime stack is available through the repository wrapper path.
9. [x] Perform one manual Playwright MCP validation against `http://host.docker.internal:5001/ingest` using `/fixtures/repo/large-planning-doc.md`, confirm the Story 54 runtime markers plus the repaired cancellation behavior, and check that the browser debug console shows no logged errors during the proof.
10. [x] Run `npm run compose:down` after manual Playwright MCP validation completes so the final regression proof does not leave shared runtime services running.

#### Implementation notes

- Subtask 1: Re-read the full Story 54 plan plus the review evidence, findings, and blind-spot challenge artifacts; confirmed Findings 1-3 map directly to the fixes delivered in Tasks 6-8, and confirmed Tasks 1-5 still cover the original large-text chunking, provider dispatch, AST delta mode, docs, and end-to-end proof scope.
- Subtask 2: Final Task 9 notes now distinguish direct proof from acceptable indirect proof: direct proof came from the full server/client/unit/cucumber/e2e wrappers plus the manual browser/runtime verification, while the only remaining indirect-proof areas are the plan-approved behavioral claims such as large-text local-backoff efficiency and broader compatibility guarantees that are intentionally not benchmark-gated.
- Subtask 3: No proof command failed in a way that required reopening the plan. The only wrinkle was the e2e wrapper’s ambiguous zero-count summary, and inspecting `logs/test-summaries/e2e-tests-latest.log` showed the real result was `expected: 54`, `unexpected: 0`, so no new review-fix task was needed.
- Testing 1: `npm run build:summary:server` passed with `agent_action: skip_log`, so the full server build still compiles cleanly after the review-fix tasks.
- Testing 2: `npm run build:summary:client` passed with `agent_action: skip_log`, so the browser workspace still typechecks and builds cleanly after the Story 54 review-fix tasks.
- Testing 3: `npm run test:summary:server:unit` passed cleanly with 1547/1547 tests green and `agent_action: skip_log`, so the full server unit suite still covers both the original Story 54 behavior and the reopened cancellation fixes without targeted reruns.
- Testing 4: `npm run test:summary:server:cucumber` passed cleanly with 80/80 tests green and `agent_action: skip_log`, so the API-visible ingest and cancellation flows still pass through the full Testcontainers wrapper after the review-fix tasks.
- Testing 5: `npm run test:summary:client` passed cleanly with 656/656 tests green and `agent_action: skip_log`, so the unchanged browser-facing regression surface remains green after the Story 54 review-fix tasks.
- Testing 6: `npm run test:summary:e2e` ended with `agent_action: inspect_log` because the wrapper summary emitted ambiguous zero counts, but `logs/test-summaries/e2e-tests-latest.log` showed the real Playwright stats as `expected: 54`, `unexpected: 0`, and `flaky: 0`, so the full compose-backed browser suite still passed without needing a rerun.
- Testing 7: `npm run compose:build:summary` passed with `agent_action: skip_log`, so the final manual runtime proof will run against freshly built standard-stack images through the repository wrapper path.
- Testing 8: `npm run compose:up` started the standard runtime stack cleanly, including healthy `codeinfo2-server-1` and started `codeinfo2-client-1`, so the host-mapped manual proof can now run against `http://host.docker.internal:5001/ingest`.
- Testing 9: Manual Playwright MCP validation against `http://host.docker.internal:5001/ingest` used `/fixtures/repo/large-planning-doc.md` through the existing ingest UI and captured large-text run `c09f21cb-c178-4335-a83d-f64064a10ad6` plus cancel run `7ac03839-6831-4315-9e22-5f0201fc5813`. Server logs confirmed `DEV-0000054:large_text_path_selected` with `strategy=prose` and `DEV-0000054:embedding_dispatch_slot_filled`, `/ingest/status/:runId` confirmed the large run completed and the second run cancelled cleanly, and Playwright console inspection returned no error-level messages during the proof.
- Testing 10: `npm run compose:down` completed cleanly, so the final regression proof left no shared standard-stack services running.
- Final validation summary: Story 54 now has direct wrapper proof for server build, client build, full server unit, full server cucumber, full client, full e2e, compose build, and manual host-mapped browser validation after the review-fix tasks. No further review-fix work is needed because the reopened findings map cleanly to Tasks 6-8 and the final revalidation reconfirmed the original large-text, dispatch, AST, and browser proof surfaces.
- Update this section during implementation with concise notes describing what was revalidated, what artifacts were checked, what issues were encountered, and why Story 54 can be closed again once this task is complete.
- Record final validation outcomes, important proof artifacts, and any residual indirect-proof areas that remain acceptable under the canonical plan.

## Code Review Findings – 2026-03-29 Blind-Spot Challenge

Story 54 is reopened again because the latest blind-spot challenge found one additional `must_fix` issue in the current repository after the general findings pass had tentatively concluded with no endorsed findings. The durable review artifacts for this reopen decision are:

- Evidence: [codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-evidence.md)
- Findings: [codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-findings.md)
- Blind-spot challenge: [codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-blind-spot-challenge.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-blind-spot-challenge.md)

The late review finding that must be fixed before Story 54 can stay complete is:

1. After dispatcher drain and the last explicit cancellation check, `processRun(...)` can still write final root metadata and publish `completed` if `/ingest/cancel/:runId` lands during the narrow finalization window. That breaks the story's coherent-cancel contract because a user-visible cancel can still be overwritten back to `completed`.

The follow-up tasks below keep repository ownership explicit, fix only this late-reviewed defect, and end with a fresh full revalidation pass that re-proves Story 54 through the repository's wrapper-first workflow.

---

### Task 10. Fence The Post-Dispatch Finalization Window Against Late Cancel Overwrite

- Repository Name: `Current Repository`
- Task Dependencies: `Task 9`
- Task Status: `__done__`
- Git Commits:
  - None yet

#### Overview

This task fixes the late blind-spot finding where Story 54's worker can still overwrite a just-cancelled run back to `completed` after dispatcher drain has already finished. The fix must keep the existing cancel route contract, but it must ensure that the narrow finalization window between the last dispatcher-drain cancellation check and the final root metadata / terminal-status writes still converges on one cancelled terminal outcome.

#### Task Exit Criteria

- If cancel lands after dispatcher drain but before final root metadata and status writes, the run still terminates as `cancelled` instead of being overwritten back to `completed`.
- The worker no longer writes completed root metadata, ingest-file state, or AST persistence for a run that has already entered cancel cleanup in that narrow finalization window.
- Direct proof exists for the exact reviewed timing window, not just the earlier cancel-before-persist or cancel-before-dispatch paths.

#### Documentation Locations

- Blind-spot challenge: [codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-blind-spot-challenge.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-blind-spot-challenge.md)

#### Subtasks

1. [x] Re-read the Story 54 cancellation acceptance criteria plus the current evidence, findings, and blind-spot challenge artifacts, then inspect `server/src/ingest/ingestJob.ts`, `server/src/routes/ingestCancel.ts`, `server/src/test/unit/ingest-cancel.test.ts`, and `server/src/test/features/ingest-cancel.feature` so this fix targets the exact post-dispatch finalization gap rather than reopening earlier cancellation work.
2. [x] Update `server/src/ingest/ingestJob.ts` so a cancel that lands after dispatcher drain and before final root metadata or terminal-status writes still takes the cancelled path. The chosen fence must prevent completed root metadata, completed status publication, ingest-file writes, and AST writes from racing ahead once cancellation is visible in that finalization window.
3. [x] Keep `server/src/routes/ingestCancel.ts` on the existing API surface unless a route contract change is proven unavoidable. The preferred fix is an ingest-worker finalization fence, not a new browser-visible cancel mode.
4. [x] Add direct unit coverage in `server/src/test/unit/ingest-cancel.test.ts` for the exact reviewed timing window: cancel after dispatcher drain but before final root metadata or terminal-status writes must still leave the run cancelled.
5. [x] Update `server/src/test/features/ingest-cancel.feature` and its steps only if one focused API-visible scenario is needed to prove that `/ingest/cancel/:runId` cannot be overwritten back to `completed` during the late finalization window.
6. [x] Run `npx eslint server/src/ingest/ingestJob.ts server/src/routes/ingestCancel.ts server/src/test/unit/ingest-cancel.test.ts server/src/test/steps/ingest-manage.steps.ts --max-warnings=0`. The pass condition is zero ESLint errors and zero warnings for the touched `.ts` files. If ESLint can auto-fix any touched `.ts` file, rerun the same command with `--fix` before making manual style edits. If `server/src/test/steps/ingest-manage.steps.ts` is unchanged, remove it from the command when running it.
7. [x] Run `npx prettier --check server/src/ingest/ingestJob.ts server/src/routes/ingestCancel.ts server/src/test/unit/ingest-cancel.test.ts server/src/test/features/ingest-cancel.feature server/src/test/steps/ingest-manage.steps.ts`. The pass condition is that every touched file is already formatted. If Prettier reports differences, rerun the same file list with `npx prettier --write` before manual formatting edits. If `server/src/test/steps/ingest-manage.steps.ts` is unchanged, remove it from the command when running it.

#### Testing

1. [x] Do not attempt to run build or test commands for this task outside the repository wrappers. Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/build-server-latest.log` if the wrapper reports failure, unexpected warnings, or an ambiguous result.
2. [x] Do not attempt narrow server validation for this task before the wrapper path succeeds. Run `npm run test:summary:server:unit` and confirm the full server unit wrapper passes for the Task 10 late-cancel finalization fix. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands for `server/src/test/unit/ingest-cancel.test.ts`, then rerun full `npm run test:summary:server:unit`.
3. [x] Do not attempt to run the Cucumber feature directly as the primary proof for this task. Run `npm run test:summary:server:cucumber` and confirm the API-visible cancel path still converges on one cancelled terminal outcome after the Task 10 finalization fence. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands for `server/src/test/features/ingest-cancel.feature`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read the Story 54 cancellation acceptance criteria plus the latest evidence, findings, and blind-spot challenge artifacts, then inspected the post-dispatch finalization path in `server/src/ingest/ingestJob.ts`, the unchanged cancel route surface, and the current cancel unit/feature proofs so Task 10 stays focused on the late completed-overwrite window rather than reopening earlier Task 6-8 races.
- Subtask 2: Added a run-scoped finalization barrier plus post-step cancellation rechecks in `server/src/ingest/ingestJob.ts`, so late cancel now fences the final root metadata, ingest-file, AST, and terminal-status path instead of letting the worker drift back to `completed`.
- Subtask 3: Kept `server/src/routes/ingestCancel.ts` unchanged because the fix stayed inside the ingest worker finalization path and did not require a route contract change.
- Subtask 4: Added a direct unit test that blocks the final completed-root write, cancels in that exact post-dispatch window, then proves the run still converges on `cancelled` without publishing `ingest completed`.
- Subtask 5: Left `server/src/test/features/ingest-cancel.feature` unchanged because the existing API-visible cancel proof remains the right integration surface; Task 10 will rely on the required full Cucumber wrapper to confirm the late finalization fence without adding a new feature-only scenario.
- Subtask 6: `npx eslint server/src/ingest/ingestJob.ts server/src/routes/ingestCancel.ts server/src/test/unit/ingest-cancel.test.ts --max-warnings=0` passed cleanly; `server/src/test/steps/ingest-manage.steps.ts` stayed unchanged and was removed from the lint command per the task note.
- Subtask 7: `npx prettier --check server/src/ingest/ingestJob.ts server/src/routes/ingestCancel.ts server/src/test/unit/ingest-cancel.test.ts` initially flagged `server/src/ingest/ingestJob.ts`, so I ran the allowed `--write` pass and then reran `--check`, which passed cleanly. The unchanged feature and step files were omitted from the Prettier command per the task note.
- Testing 1: The first `npm run build:summary:server` run failed because the new finalization-step helper accepted only `Promise<void>` while several awaited cleanup calls return values. Widening that helper to `Promise<unknown>` fixed the typing issue, and the rerun passed with `agent_action: skip_log`.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with 1548/1548 tests green and `agent_action: skip_log`, so the full server unit suite now covers the new late-finalization cancel fence without needing a targeted rerun.
- Testing 3: `npm run test:summary:server:cucumber` passed cleanly with 80/80 tests green and `agent_action: skip_log`, so the API-visible cancel path still converges on one cancelled terminal outcome after the Task 10 finalization fence.
- Update this section during implementation with concise notes describing what was done, what issues were encountered, and what decisions were made.
- If a blocker is found during implementation, record the exact subtask or testing step, what was attempted, and what capability is missing.

---

### Task 11. Revalidate Story 54 After The Blind-Spot Review Fix

- Repository Name: `Current Repository`
- Task Dependencies: `Task 10`
- Task Status: `__to_do__`
- Git Commits:
  - None yet

#### Overview

This final revalidation task closes the latest Story 54 review loop. It must prove that the Task 10 late-cancel finalization fix resolves the blind-spot finding without regressing the already-finished large-text chunking, provider dispatch, AST delta-mode, documentation, and end-to-end runtime proof that Story 54 previously completed.

#### Task Exit Criteria

- The late blind-spot review finding is fixed, the current durable review artifacts remain in history with the reopened plan, and Story 54 again satisfies its acceptance criteria through the repository's wrapper-first validation flow.
- Revalidation explicitly proves both the original Story 54 behavior and the repaired late-cancel finalization path.

#### Documentation Locations

- Evidence: [codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-evidence.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-evidence.md)
- Findings: [codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-findings.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-findings.md)
- Blind-spot challenge: [codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-blind-spot-challenge.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codeInfoStatus/reviews/0000054-20260329T073223Z-b2a04d3b-blind-spot-challenge.md)

#### Subtasks

1. [ ] Re-read the full Story 54 plan plus the current evidence, findings, and blind-spot challenge artifacts, and trace the new late finalization finding back to the fix delivered in Task 10 while also confirming that Tasks 1 through 9 still cover the original Story 54 scope.
2. [ ] Update Task 11 Implementation notes as revalidation proceeds so the final close-out explicitly records which acceptance criteria still have direct proof, which still rely on indirect proof by plan design, and why no further review-fix tasks are needed.
3. [ ] If any proof command fails during this revalidation task, capture the exact failure in the implementation notes and reopen the plan again only if a new review-fix task is genuinely required.

#### Testing

1. [ ] Do not attempt to run build commands for this final validation task outside the repository wrappers. Run `npm run build:summary:server` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/build-server-latest.log` if the wrapper reports failure, unexpected warnings, or an ambiguous result.
2. [ ] Do not attempt to run client build commands for this final validation task outside the repository wrappers. Run `npm run build:summary:client` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/build-client-latest.log` if the wrapper reports failure, unexpected warnings, or an ambiguous result.
3. [ ] Do not attempt narrow server validation before the wrapper path succeeds for this final validation task. Run `npm run test:summary:server:unit` and confirm the full server unit wrapper passes with the Task 10 late-cancel finalization fix in place. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands, then rerun full `npm run test:summary:server:unit`.
4. [ ] Do not attempt narrow Cucumber validation before the wrapper path succeeds for this final validation task. Run `npm run test:summary:server:cucumber` and confirm the full server Cucumber/Testcontainers wrapper passes with the Task 10 fix in place. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands, then rerun full `npm run test:summary:server:cucumber`.
5. [ ] Do not attempt client tests for this final validation task outside the repository wrappers. Run `npm run test:summary:client` and confirm the client wrapper passes for the unchanged browser-facing regression surface. If `failed > 0`, inspect the exact `test-results/client-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper commands, then rerun full `npm run test:summary:client`.
6. [ ] Do not attempt Playwright directly as the primary automated proof for this final validation task. Run `npm run test:summary:e2e` and allow up to 7 minutes for the wrapper to finish while it proves the existing ingest UI flow and Story 54 browser path. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, diagnose with targeted wrapper commands, then rerun full `npm run test:summary:e2e`.
7. [ ] Because this is the fresh final regression task and the browser-visible path remains in scope, run `npm run compose:build:summary` and confirm the wrapper finishes successfully without `agent_action: inspect_log`. Only open `logs/test-summaries/compose-build-latest.log` if the wrapper reports failure or an ambiguous result.
8. [ ] Run `npm run compose:up` before manual validation so the standard runtime stack is available through the repository wrapper path.
9. [ ] Perform one manual Playwright MCP validation against `http://host.docker.internal:5001/ingest` using `/fixtures/repo/large-planning-doc.md`, confirm the Story 54 runtime markers plus the repaired late-cancel finalization behavior, and check that the browser debug console shows no logged errors during the proof.
10. [ ] Run `npm run compose:down` after manual Playwright MCP validation completes so the final regression proof does not leave shared runtime services running.

#### Implementation notes

- Update this section during implementation with concise notes describing what was revalidated, what artifacts were checked, what issues were encountered, and why Story 54 can be closed again once this task is complete.
- Record final validation outcomes, important proof artifacts, and any residual indirect-proof areas that remain acceptable under the canonical plan.
