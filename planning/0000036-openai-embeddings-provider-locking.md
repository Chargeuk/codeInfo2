# Story 0000036 – OpenAI Embedding Provider Support for Ingest and Vector Search Locking

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

CodeInfo2 currently requires LM Studio to run repository ingest embeddings. If a developer cannot run LM Studio locally, they cannot ingest repositories, and that blocks core code-intelligence workflows.

This story adds OpenAI embeddings as an alternative provider for all embedding operations in this codebase, while preserving existing LM Studio behavior.

User-visible outcome we are targeting:

- If `OPENAI_EMBEDDING_KEY` is configured on the server, OpenAI embedding models are shown in the Ingest page Embedding model dropdown.
- If `OPENAI_EMBEDDING_KEY` is not configured, an information bar is shown explaining that `OPENAI_EMBEDDING_KEY` must be set to use OpenAI embedding models.
- Ingest can run using either LM Studio or OpenAI embedding models (subject to locking rules and availability).
- Users are not asked to configure embedding dimensions in the UI; the system uses each selected model's default vector length.
- OpenAI model visibility in the Ingest dropdown is constrained by a curated allowlist and not by raw `models.list()` output alone.
- If `OPENAI_EMBEDDING_KEY` is configured but OpenAI model discovery fails transiently, `GET /ingest/models` still returns LM Studio models and includes explicit OpenAI warning state for the UI.

Critical consistency rule that must remain true:

- Once a repository/index is embedded with a provider+model combination, that same embedding provider+model must continue to be used for future embeddings and query embeddings (vector search / MCP tooling), unless the vector store is reset according to existing lock-reset behavior.
- This is the same fundamental lock rule currently applied for LM Studio model locking, expanded to include provider + model, with dimensions implicitly fixed to the selected model default (no user override in this story).
- No DB migration is required for historical model-only lock/root metadata. If provider is absent, runtime behavior must infer `provider=lmstudio` and continue to work. Whenever a root is newly embedded or re-embedded, provider metadata must be written explicitly.

Lock metadata naming decision and consequences:

- Best option selected for this story is Option A: canonical naming uses `embeddingProvider` + `embeddingModel` across Chroma metadata, root metadata, and API contracts.
- Consequence: backward compatibility must be implemented as dual-read compatibility (`embeddingProvider`/`embeddingModel` first, then legacy fields such as `lockedModelId` and legacy root `model`, with provider defaulting to `lmstudio` when missing).
- Consequence: write path is single canonical format; new ingest/re-embed operations persist only canonical naming so legacy state is progressively replaced without migration.
- Consequence: short-term implementation scope increases (translation logic + tests), but long-term risk is reduced by avoiding mixed legacy/new naming contracts.

Current architecture facts that this story must account for:

- Embeddings are generated in ingest jobs (`server/src/ingest/ingestJob.ts`) and also during vector-search query execution (`server/src/lmstudio/toolService.ts` through `getVectorsCollection({ requireEmbedding: true })` in `server/src/ingest/chromaClient.ts`).
- Therefore, this story must update both index-time embeddings and query-time embeddings.
- `/ingest/models` currently uses `server/src/ingest/modelLock.ts`, which is a placeholder returning `null`, while actual lock enforcement in ingest start uses `server/src/ingest/chromaClient.ts`. This divergence must be resolved as part of provider/model lock unification.

OpenAI research points (validated during discovery):

- OpenAI embeddings are created via `POST /embeddings` (`client.embeddings.create(...)` in `openai-node`).
- Available models for the API key are listed via `GET /models` (`client.models.list()`), but model capability filtering is application-side.
- Embedding input constraints in OpenAI API reference include: max input tokens by model (8192 tokens for `text-embedding-ada-002`, and docs currently state 8192 for all embedding models), max 2048 inputs per request array, and max 300,000 total input tokens across a single request.
- `dimensions` is supported for `text-embedding-3-small` (1..1536) and `text-embedding-3-large` (1..3072). This story keeps default dimensions only (no UI control, no request override).

OpenAI dropdown filtering decision for this story:

- Use a curated server-side allowlist for OpenAI embedding models.
- Default allowlist values for this story: `text-embedding-3-small`, `text-embedding-3-large`.
- Final dropdown options are the intersection of:
  - the curated allowlist, and
  - models actually available to the configured `OPENAI_EMBEDDING_KEY` from `client.models.list()`.
- If the key is present but none of the curated models are available, show no OpenAI options and return a clear informational message state.
- Server enforces the same allowlist on ingest-start/reembed validation; clients cannot bypass the allowlist by posting arbitrary model ids.
- `/ingest/models` includes explicit OpenAI availability fields so UI behavior does not depend on inference (for example `openaiEnabled`, `openaiStatusCode`, warning metadata).

Operational failures to handle explicitly:

- OpenAI auth and key issues (missing/invalid key).
- Quota/credits exhaustion and related billing failures.
- Rate limits.
- Upstream/network timeouts or transient API errors.

Error handling must remain deterministic and user-readable in ingest and vector-search surfaces, including clear messages for OpenAI credit/quota failures.

OpenAI embedding failure taxonomy for this story (documented from OpenAI API + SDK behavior):

- `OPENAI_AUTH_FAILED`: map `401` authentication failures (`invalid_api_key`, `invalid_api_key_type`).
- `OPENAI_PERMISSION_DENIED`: map `403` permission failures (`organization_deactivated`, access-denied conditions).
- `OPENAI_MODEL_UNAVAILABLE`: map model-selection failures (`404 model_not_found`) when a requested embedding model is unavailable to the key/org.
- `OPENAI_BAD_REQUEST`: map `400` invalid request errors (`invalid_request_error`) for malformed arguments.
- `OPENAI_INPUT_TOO_LARGE`: map `400` token/size limit failures (for example `context_length_exceeded`) when embedding inputs violate model/request limits.
- `OPENAI_UNPROCESSABLE`: map `422` semantically invalid requests.
- `OPENAI_RATE_LIMITED`: map `429 rate_limit_exceeded`.
- `OPENAI_QUOTA_EXCEEDED`: map `429 insufficient_quota` and credit/billing exhaustion states.
- `OPENAI_TIMEOUT`: map request timeout/network-timeout failures (`408` retry paths and SDK `APIConnectionTimeoutError`).
- `OPENAI_CONNECTION_FAILED`: map SDK connectivity failures (`APIConnectionError`) where no HTTP response is returned.
- `OPENAI_UNAVAILABLE`: map upstream transient failures (`>=500`) and other retryable availability problems.

Retryability guidance for this taxonomy:

- Retryable by default: `OPENAI_RATE_LIMITED`, `OPENAI_TIMEOUT`, `OPENAI_CONNECTION_FAILED`, `OPENAI_UNAVAILABLE`.
- Non-retryable by default: `OPENAI_AUTH_FAILED`, `OPENAI_PERMISSION_DENIED`, `OPENAI_MODEL_UNAVAILABLE`, `OPENAI_BAD_REQUEST`, `OPENAI_INPUT_TOO_LARGE`, `OPENAI_UNPROCESSABLE`, `OPENAI_QUOTA_EXCEEDED`.
- For retryable categories, this story will apply server-side retries using bounded exponential backoff before returning a terminal error.

### Acceptance Criteria

- Server recognizes `OPENAI_EMBEDDING_KEY` and conditionally enables OpenAI embedding provider support without breaking LM Studio support.
- Backward compatibility is a hard requirement for this story: existing embedded repositories created before provider-aware naming must continue working without manual migration.
- `GET /ingest/models` returns OpenAI embedding models when `OPENAI_EMBEDDING_KEY` is present and valid enough to list models.
- If OpenAI model listing fails transiently, `GET /ingest/models` still succeeds with LM Studio model results and includes explicit OpenAI warning state in the response.
- When `OPENAI_EMBEDDING_KEY` is missing, the Ingest page displays an information bar that clearly states `OPENAI_EMBEDDING_KEY` is required for OpenAI embedding models.
- `/ingest/models` exposes explicit OpenAI availability contract fields (including enabled/status/warning state) so UI info bars and empty/error states are deterministic.
- Ingest UI model selection supports OpenAI models and LM Studio models in one coherent dropdown without ambiguity.
- OpenAI options in the Ingest dropdown are restricted to a curated allowlist (`text-embedding-3-small`, `text-embedding-3-large`) intersected with models available to the configured key.
- Dropdown ordering for OpenAI options is stable and deterministic (small before large).
- If `OPENAI_EMBEDDING_KEY` is present but no curated model is available, the UI surfaces a clear informational state and does not show fallback non-allowlisted OpenAI models.
- Ingest UI does not expose user-selectable embedding dimensions for OpenAI models.
- Server uses model-default embedding vector lengths for all providers in this story (no custom dimensions override path).
- Embedding lock metadata is provider-aware, not model-only. At minimum, lock state includes provider + model id.
- Existing lock behavior is preserved: if vectors/roots are non-empty and lock exists, starting ingest with a different embedding provider/model is rejected with a stable conflict contract.
- Re-embed path uses the stored provider+model lock contract from prior ingest metadata and does not silently switch providers.
- Query-time embedding for vector search (REST `/tools/vector-search`, classic MCP `VectorSearch`, and paths relying on `getVectorsCollection({ requireEmbedding: true })`) uses the same locked provider+model contract used at ingest time.
- Query-time embedding uses the same default vector length contract as ingest-time embeddings for the locked provider/model.
- OpenAI embedding API failures are mapped to stable, actionable server responses; quota/credit exhaustion is handled explicitly and surfaced as a meaningful error.
- Existing model-only roots/locks continue to work without DB migration by inferring `provider=lmstudio` when provider metadata is absent.
- New ingest and re-embed writes persist explicit provider metadata so inferred state is gradually replaced by canonical provider+model data.
- Canonical lock metadata naming is standardized to Option A: `embeddingProvider` + `embeddingModel` across Chroma metadata, root metadata, and API responses, with compatibility reads for legacy fields.
- Consequence of Option A is explicitly required: legacy metadata must remain readable while canonical naming is the only required write shape for new operations.
- Lock-source divergence is removed: `/ingest/models` lock reporting and ingest start lock enforcement read from one canonical lock implementation.
- Existing LM Studio-only workflows continue to work unchanged when OpenAI key is absent.
- Server-side validation rejects OpenAI embedding model ids that are not in the curated allowlist, even if they appear in upstream model listings.
- OpenAI ingest/vector-search failures use a stable internal taxonomy that distinguishes auth, quota, rate limit, input-size, model availability, timeout/network, and upstream availability errors.
- Retryable OpenAI failures (`OPENAI_RATE_LIMITED`, `OPENAI_TIMEOUT`, `OPENAI_CONNECTION_FAILED`, `OPENAI_UNAVAILABLE`) are retried server-side with bounded exponential backoff before surfacing failure.
- Tests are expanded to cover:
  - OpenAI models shown/hidden based on `OPENAI_EMBEDDING_KEY`.
  - Allowlist filtering and deterministic ordering for OpenAI models.
  - Info-bar behavior when key missing.
  - Key-present but no-curated-model-available informational behavior.
  - Key-present plus transient OpenAI model-list failure returns LM Studio models and explicit OpenAI warning state.
  - Rejection of non-allowlisted OpenAI model ids at ingest start/reembed.
  - Provider/model lock enforcement across ingest and vector search.
  - Legacy embedded repositories (model-only metadata) remain fully functional under new canonical metadata naming.
  - OpenAI error mapping, including quota/credit failures and bounded retry behavior on retryable categories.

### Out Of Scope

- Adding OpenAI as a chat/completions provider in this story (this story is embeddings-only).
- Adding runtime UI fields for directly entering/storing secrets in the browser.
- Multi-provider mixed-vector indexes (no mixing LM Studio and OpenAI vectors in one locked index).
- Reworking unrelated chat/agent/flow provider-selection behavior.
- Any changes to Codex provider flows unrelated to embedding architecture.

### Questions

## Implementation Ideas

- Introduce a provider abstraction under server ingest tooling, e.g. an `EmbeddingProvider` interface used by ingest, re-embed, and query embeddings.
  - `listModels()`
  - `embed(modelId, text)` / `embedMany(...)`
  - `countTokens(...)` and max-token capability access (or equivalent strategy)
  - provider id metadata
- Implement two concrete adapters:
  - LM Studio embedding provider (wrapping current `@lmstudio/sdk` usage).
  - OpenAI embedding provider (using official OpenAI SDK and `OPENAI_EMBEDDING_KEY`).
- Add a small provider registry/factory that resolves enabled providers at runtime based on environment.
- Add an OpenAI embedding allowlist config on the server (defaulting to `text-embedding-3-small,text-embedding-3-large`) and apply it consistently in list + ingest validation paths.
- Update `/ingest/models` contract to expose explicit OpenAI availability/warning fields and keep LM Studio model output available when OpenAI model listing fails transiently.
- Set and document a strict dimensions policy for this story: no UI control and no request-level override; always use the selected model default vector length.
- Treat missing historical provider metadata as `lmstudio` at read/lock-evaluation time, and write explicit provider metadata on all new ingest and re-embed updates.
- Refactor current LM Studio-specific embedding calls:
  - `server/src/ingest/ingestJob.ts` (`embedText`, chunker model acquisition)
  - `server/src/ingest/chromaClient.ts` (`LmStudioEmbeddingFunction`, `resolveLockedEmbeddingFunction`)
  - `server/src/routes/ingestModels.ts` (model listing)
  - `server/src/lmstudio/toolService.ts` vector-search query embedding path
- Unify lock metadata in Chroma collection metadata and root metadata:
  - Option A selected: canonical lock shape uses explicit `embeddingProvider` + `embeddingModel` fields in Chroma metadata, root metadata, and API responses.
  - Preserve backward compatibility by reading legacy metadata (`lockedModelId`, legacy root `model`, missing provider) and translating it to canonical in-memory lock state (`embeddingProvider=\"lmstudio\"` inference when absent).
  - On new ingest/re-embed writes, persist canonical fields explicitly so legacy records are progressively replaced.
  - Ensure lock checks in ingest start and lock display in `/ingest/models` and `/ingest/roots` use the same canonical source.
- Remove or repurpose `server/src/ingest/modelLock.ts` placeholder so lock reporting cannot diverge from enforcement.
- Ensure vector search path loads and uses the locked provider/model for query embeddings so retrieval space matches indexed vectors.
- Add OpenAI error mapping utility to normalize quota/auth/rate-limit/upstream failures into stable API responses and logs.
- Implement bounded exponential backoff retry utility for retryable OpenAI categories and apply it consistently in ingest-time and query-time embedding calls.
- Include OpenAI `error.code` + HTTP-status mapping rules for `insufficient_quota`, `rate_limit_exceeded`, `invalid_api_key`, `model_not_found`, and input-limit failures, and carry retryability metadata through ingest/vector-search error payloads.
- Update Ingest UI model handling to support provider-tagged model labels and missing-key info banner copy.
- Keep backward compatibility for LM Studio-only setups and existing lock reset behavior when collections are emptied/removed.
