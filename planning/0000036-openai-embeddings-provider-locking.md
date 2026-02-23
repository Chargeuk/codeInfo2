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

- Backward compatibility is a hard requirement: repositories embedded before provider-aware metadata continue working with no manual migration and no data rewrite step.
- Server reads `OPENAI_EMBEDDING_KEY` at runtime and only enables OpenAI embedding model discovery when the key is configured.
- `GET /ingest/models` returns `200` with a deterministic contract containing `models`, `lock`, and `openai` objects (defined below), even when OpenAI model-listing has a transient failure.
- `GET /ingest/models` includes LM Studio models whenever LM Studio listing succeeds; transient OpenAI listing failures do not fail the whole endpoint.
- If `OPENAI_EMBEDDING_KEY` is missing, `openai.status` is `disabled` and the UI shows an info bar that explicitly names `OPENAI_EMBEDDING_KEY` as required.
- If `OPENAI_EMBEDDING_KEY` is set and OpenAI model listing succeeds, `openai.status` is `ok` and only allowlisted OpenAI embedding models are included.
- If `OPENAI_EMBEDDING_KEY` is set and OpenAI model listing fails transiently, `openai.status` is `warning`, `openai.warning.code=OPENAI_MODELS_LIST_TEMPORARY_FAILURE`, and LM Studio options still render.
- OpenAI model options are strictly `allowlist ∩ models.list()`; no non-allowlisted OpenAI model can appear in `/ingest/models` or be accepted by ingest/reembed APIs.
- Allowlist ordering is deterministic and fixed to `text-embedding-3-small` then `text-embedding-3-large`.
- Ingest dropdown options remain unambiguous by showing provider + model identity for every option (for example `lmstudio / <model>` and `openai / <model>`).
- Ingest UI does not expose dimensions controls; server always uses model-default embedding dimensions for both providers.
- Canonical lock identity is provider-aware and model-aware everywhere: `embeddingProvider` + `embeddingModel`.
- Starting ingest against a non-empty locked index with a different provider/model is rejected with stable `409` conflict payload including canonical lock fields.
- Re-embed always uses the stored lock provider/model and cannot silently switch provider or model.
- Query embeddings for REST `/tools/vector-search`, classic MCP `VectorSearch`, and any `getVectorsCollection({ requireEmbedding: true })` path use the same locked provider/model as ingest.
- Legacy lock metadata is still readable: if only `lockedModelId`/legacy root `model` exists, runtime infers `embeddingProvider=lmstudio`.
- New ingest/re-embed writes persist canonical lock fields and keep legacy-read compatibility.
- Option A naming is mandatory for canonical writes and API contracts: `embeddingProvider` + `embeddingModel`.
- `/ingest/models` lock reporting and ingest-start lock enforcement share one canonical lock resolver (no separate placeholder logic).
- LM Studio-only workflows remain operational when OpenAI is not configured.
- OpenAI embedding failures map to stable error taxonomy codes and include retryability metadata, with explicit handling for quota/credit exhaustion.
- Retryable OpenAI failures (`OPENAI_RATE_LIMITED`, `OPENAI_TIMEOUT`, `OPENAI_CONNECTION_FAILED`, `OPENAI_UNAVAILABLE`) use bounded exponential backoff before terminal failure.
- Retry defaults are fixed for this story: `maxRetries=3`, `baseDelayMs=500`, `maxDelayMs=8000`, jitter up to 25 percent, and wait-hint header precedence before fallback delay.
- Tests cover all acceptance behaviors above, including: missing-key UI info state, transient model-list warning state, allowlist enforcement, canonical+legacy lock handling, provider/model lock conflicts, vector-search provider parity, OpenAI failure mapping, and retry behavior.

### Out Of Scope

- Adding OpenAI as a chat/completions provider in this story (this story is embeddings-only).
- Adding runtime UI fields for directly entering/storing secrets in the browser.
- Multi-provider mixed-vector indexes (no mixing LM Studio and OpenAI vectors in one locked index).
- Reworking unrelated chat/agent/flow provider-selection behavior.
- Any changes to Codex provider flows unrelated to embedding architecture.

### Questions

## Message Contracts & Storage Shapes

### Retry Defaults (OpenAI Embedding Calls)

- `maxRetries`: `3` (three retries after initial attempt).
- `baseDelayMs`: `500`.
- `maxDelayMs`: `8000`.
- `jitter`: multiply computed delay by a random factor in `[0.75, 1.0]` (up to 25 percent reduction), aligned with OpenAI SDK behavior.
- Retryable categories remain: `OPENAI_RATE_LIMITED`, `OPENAI_TIMEOUT`, `OPENAI_CONNECTION_FAILED`, `OPENAI_UNAVAILABLE`.
- Wait-hint precedence when OpenAI indicates rate/availability pressure:
  - `retry-after-ms` header (milliseconds) when present and valid.
  - `retry-after` header (seconds or HTTP date) when present and valid.
  - `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens` when parseable as a positive reset duration.
  - Fallback to bounded exponential delay when no valid hint is available.
- Any server-provided wait hint above `60000ms` is treated as non-immediate and replaced by bounded exponential fallback, to avoid long blocking stalls in ingest/vector-search requests.

### `/ingest/models` Warning-State Message Contract

- Response shape includes explicit lock and OpenAI status envelopes so UI state is deterministic:

```json
{
  "models": [
    {
      "id": "text-embedding-3-small",
      "displayName": "text-embedding-3-small",
      "provider": "openai"
    }
  ],
  "lock": {
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small"
  },
  "lockedModelId": "text-embedding-3-small",
  "openai": {
    "enabled": true,
    "status": "warning",
    "statusCode": "OPENAI_MODELS_LIST_TEMPORARY_FAILURE",
    "warning": {
      "code": "OPENAI_MODELS_LIST_TEMPORARY_FAILURE",
      "message": "OpenAI model listing is temporarily unavailable. LM Studio models are still available.",
      "retryable": true,
      "retryAfterMs": 2000
    }
  }
}
```

- `models[*]` minimum required fields for this story:
  - `id: string`
  - `displayName: string`
  - `provider: "lmstudio" | "openai"`
- `lock` values:
  - `null` when no vectors lock exists.
  - object with canonical fields when lock exists.
- `lockedModelId` stays as a compatibility alias in this story and maps to `lock.embeddingModel` when lock is present.
- `openai.status` values:
  - `disabled`: no `OPENAI_EMBEDDING_KEY` configured.
  - `ok`: key configured and model listing succeeded.
  - `warning`: key configured but OpenAI model listing did not fully succeed.
- `openai.statusCode` values for deterministic UI handling:
  - `OPENAI_DISABLED`
  - `OPENAI_OK`
  - `OPENAI_MODELS_LIST_TEMPORARY_FAILURE`
  - `OPENAI_MODELS_LIST_AUTH_FAILED`
  - `OPENAI_MODELS_LIST_UNAVAILABLE`
- `openai.warning.code` values for this story:
  - `OPENAI_EMBEDDING_KEY_MISSING`
  - `OPENAI_MODELS_LIST_TEMPORARY_FAILURE`
  - `OPENAI_MODELS_LIST_AUTH_FAILED`
  - `OPENAI_MODELS_LIST_UNAVAILABLE`
- For the transient failure case requested in this story, use:
  - `code=OPENAI_MODELS_LIST_TEMPORARY_FAILURE`
  - `retryable=true`
  - include LM Studio models as normal; do not fail the whole endpoint.
- Ingest-page info-bar message contract:
  - Missing key: `OpenAI embedding models are unavailable. Set OPENAI_EMBEDDING_KEY on the server to enable them.`
  - Temporary listing failure: `OpenAI models are temporarily unavailable. LM Studio models are still available.`

### Ingest Start Conflict Contract (Provider-Aware Lock)

- When ingest starts with provider/model not matching the existing non-empty lock, response is:

```json
{
  "status": "error",
  "code": "MODEL_LOCKED",
  "lock": {
    "embeddingProvider": "lmstudio",
    "embeddingModel": "text-embedding-qwen3-embedding-4b"
  },
  "lockedModelId": "text-embedding-qwen3-embedding-4b"
}
```

- `lockedModelId` is compatibility-only; canonical clients should use `lock.embeddingProvider` + `lock.embeddingModel`.
- Same logical lock contract applies to re-embed entry points.

### OpenAI Embedding Failure Response Contract

- For ingest and vector-search OpenAI embedding failures, normalized payload must include:
  - `error: string` (taxonomy code listed in this plan, e.g. `OPENAI_QUOTA_EXCEEDED`)
  - `message: string` (user-readable)
  - `retryable: boolean`
  - `provider: "openai"`
  - `upstreamStatus?: number`
  - `retryAfterMs?: number`
- Quota/credits exhaustion must map to `OPENAI_QUOTA_EXCEEDED` with `retryable=false`.

### Canonical Storage Shapes (Option A + Backward Compatibility)

- Chroma/root canonical lock fields:
  - `embeddingProvider: "lmstudio" | "openai"`
  - `embeddingModel: string`
- Canonical write shape is required in both vectors metadata and root metadata after new ingest/re-embed.
- Legacy read compatibility remains mandatory:
  - If canonical fields are missing, read legacy `lockedModelId` and legacy root `model`.
  - Infer `embeddingProvider="lmstudio"` when provider is missing.
- New writes (ingest/re-embed) persist canonical fields only.

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
