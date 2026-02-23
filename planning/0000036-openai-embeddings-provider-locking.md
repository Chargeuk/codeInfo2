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

Local testing context for this story:

- For the primary local test environment backing this story, `OPENAI_EMBEDDING_KEY` is already configured in `server/.env.local` (`/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/.env.local`).
- Planning and test steps must assume the key value itself is secret and must never be copied into logs, test output, or committed files.

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
- Server non-docker startup currently calls `dotenv.config()` with default behavior (`.env` only). Docker Compose loads both `server/.env` and `server/.env.local`. This story must explicitly make local startup and docker startup behavior consistent for `OPENAI_EMBEDDING_KEY`.
- Current ingest API request shape is model-only (`model: string`) and current lock checks compare raw model string equality. Provider-aware locking must add explicit provider+model request semantics and compatibility mapping for legacy model-only clients.
- Current ingest batching is flush-count based (`INGEST_FLUSH_EVERY`) with no OpenAI-specific request-level guards. This story must add explicit OpenAI request guards for max inputs and token limits.

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
- If the key is present but none of the curated models are available, show no OpenAI options and return deterministic warning state: `openai.status="warning"` and `openai.statusCode="OPENAI_ALLOWLIST_NO_MATCH"`.
- Server enforces the same allowlist on ingest-start/reembed validation; clients cannot bypass the allowlist by posting arbitrary model ids.
- `/ingest/models` includes explicit OpenAI availability fields so UI behavior does not depend on inference (for example `openai.enabled`, `openai.statusCode`, warning metadata).

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
- Server startup parity is required: local non-docker server startup loads `server/.env.local` and `server/.env` with deterministic precedence so `OPENAI_EMBEDDING_KEY` works the same way as docker-compose startup.
- Deterministic env precedence is required: local startup loads `server/.env` first, then `server/.env.local` as override (matching docker compose env-file override semantics used in this repository).
- Server reads `OPENAI_EMBEDDING_KEY` at runtime and only enables OpenAI embedding model discovery when the key is configured.
- `GET /ingest/models` returns `200` with a deterministic contract containing `models`, `lock`, and `openai` objects (defined below), even when OpenAI model-listing has a transient failure.
- `GET /ingest/models` includes LM Studio models whenever LM Studio listing succeeds; transient OpenAI listing failures do not fail the whole endpoint.
- If `OPENAI_EMBEDDING_KEY` is missing, `openai.status` is `disabled` and the UI shows an info bar that explicitly names `OPENAI_EMBEDDING_KEY` as required.
- If `OPENAI_EMBEDDING_KEY` is set, OpenAI model listing succeeds, and at least one allowlisted model is available, `openai.status` is `ok` and only allowlisted OpenAI embedding models are included.
- If `OPENAI_EMBEDDING_KEY` is set and OpenAI model listing fails transiently, `openai.status` is `warning`, `openai.warning.code=OPENAI_MODELS_LIST_TEMPORARY_FAILURE`, and LM Studio options still render.
- If `OPENAI_EMBEDDING_KEY` is set, model listing succeeds, but allowlist intersection is empty, `openai.status` is `warning`, `openai.statusCode=OPENAI_ALLOWLIST_NO_MATCH`, and LM Studio options still render.
- OpenAI model options are strictly `allowlist ∩ models.list()`; no non-allowlisted OpenAI model can appear in `/ingest/models` or be accepted by ingest/reembed APIs.
- Allowlist ordering is deterministic and fixed to `text-embedding-3-small` then `text-embedding-3-large`.
- Ingest dropdown options remain unambiguous by showing provider + model identity for every option (for example `lmstudio / <model>` and `openai / <model>`).
- Ingest UI does not expose dimensions controls; server always uses model-default embedding dimensions for both providers.
- `POST /ingest/start` supports canonical request fields `embeddingProvider` + `embeddingModel`; legacy request field `model` remains accepted as compatibility input and maps to `embeddingProvider=lmstudio`.
- Canonical lock identity is provider-aware and model-aware everywhere: `embeddingProvider` + `embeddingModel`.
- Canonical lock includes resolved vector dimension (`embeddingDimensions`) captured from the first successful embedding write and re-used for validation/diagnostics.
- Starting ingest against a non-empty locked index with a different provider/model is rejected with stable `409` conflict payload including canonical lock fields.
- Re-embed always uses the stored lock provider/model and cannot silently switch provider or model.
- Query embeddings for REST `/tools/vector-search`, classic MCP `VectorSearch`, and any `getVectorsCollection({ requireEmbedding: true })` path use the same locked provider/model as ingest.
- Query embedding path validates generated embedding dimension against locked dimension before issuing Chroma query; mismatches fail with deterministic server error instead of leaking raw Chroma exceptions.
- Legacy lock metadata is still readable: if only `lockedModelId`/legacy root `model` exists, runtime infers `embeddingProvider=lmstudio`.
- New ingest/re-embed writes persist canonical lock fields and keep legacy-read compatibility.
- Option A naming is mandatory for canonical writes and API contracts: `embeddingProvider` + `embeddingModel`.
- `/ingest/models` lock reporting and ingest-start lock enforcement share one canonical lock resolver (no separate placeholder logic).
- Compatibility alias behavior is explicit and consistent across current lock-reporting surfaces: `/ingest/models`, `/ingest/roots`, `/tools/ingested-repos`, `POST /ingest/start` lock conflict payload, and classic MCP `ListIngestedRepositories`.
- LM Studio-only workflows remain operational when OpenAI is not configured.
- OpenAI embedding failures map to stable error taxonomy codes and include retryability metadata, with explicit handling for quota/credit exhaustion.
- Retryable OpenAI failures (`OPENAI_RATE_LIMITED`, `OPENAI_TIMEOUT`, `OPENAI_CONNECTION_FAILED`, `OPENAI_UNAVAILABLE`) use bounded exponential backoff before terminal failure.
- Retry defaults are fixed for this story: `maxRetries=3`, `baseDelayMs=500`, `maxDelayMs=8000`, jitter factor `[0.75, 1.0]` (up to 25 percent reduction), and wait-hint header precedence before fallback delay.
- OpenAI embedding request batching enforces upstream limits: each request array has at most 2048 inputs, each input obeys per-model token limits, and total tokens per request do not exceed 300000.
- OpenAI SDK auto-retries are disabled for embedding calls (`maxRetries=0`) so only one retry layer (the server retry utility in this story) controls backoff and observability.
- Tests cover all acceptance behaviors above, including: missing-key UI info state, transient model-list warning state, allowlist enforcement, canonical+legacy lock handling, provider/model lock conflicts, vector-search provider parity, OpenAI failure mapping, and retry behavior.

### Out Of Scope

- Adding OpenAI as a chat/completions provider in this story (this story is embeddings-only).
- Adding runtime UI fields for directly entering/storing secrets in the browser.
- Multi-provider mixed-vector indexes (no mixing LM Studio and OpenAI vectors in one locked index).
- Reworking unrelated chat/agent/flow provider-selection behavior.
- Any changes to Codex provider flows unrelated to embedding architecture.

### Questions

## Scope Validation & Research Findings

- Overall scope is now implementation-ready after adding the requirements below; no additional blocking discovery is required before tasking.
- Confirmed from repository code paths that lock state is currently exposed by multiple surfaces using `lockedModelId` and model-only root metadata. This is why compatibility aliases must be explicitly required on every affected surface, not only `/ingest/models`.
- Confirmed from repository code paths that ingest write batching is count-based (`INGEST_FLUSH_EVERY`) and not OpenAI-limit-aware. Explicit OpenAI request guardrails are now mandatory in this plan.
- Confirmed from repository code paths that non-docker startup currently loads `.env` only by default; this plan now requires explicit `.env.local` loading parity so `OPENAI_EMBEDDING_KEY` behavior is predictable.
- Confirmed from OpenAI docs that:
  - embeddings endpoint supports default and shortened vectors (`dimensions`) for `text-embedding-3-small` and `text-embedding-3-large`,
  - embeddings request constraints include max input token limits, max 2048 inputs per request array, and max 300000 total input tokens per request,
  - model listing endpoint returns basic model metadata and requires application-side capability filtering.
- Confirmed from Chroma docs that collection/query embedding dimensions must match; mismatches fail. This plan now requires dimension-aware lock metadata and deterministic mismatch errors.
- Confirmed from OpenAI Node SDK docs that SDK-level retries/timeouts exist by default; this plan now requires explicit retry ownership (SDK retries disabled for embeddings calls, server retry utility authoritative).

## Junior-Readable Definition of Done

This section defines concrete "done" behavior so a junior developer can verify outputs without inferring intent.

### Scenario 1: OpenAI key missing

- Setup: `OPENAI_EMBEDDING_KEY` is not set in server runtime.
- Required output:
  - `GET /ingest/models` returns `200`.
  - Response includes `openai.enabled=false`, `openai.status="disabled"`, `openai.statusCode="OPENAI_DISABLED"`.
  - Response still includes LM Studio models when LM Studio is reachable.
  - Ingest page shows info bar: `OpenAI embedding models are unavailable. Set OPENAI_EMBEDDING_KEY on the server to enable them.`
- Not allowed:
  - OpenAI models appearing in dropdown.
  - Entire endpoint failing only because OpenAI key is missing.

### Scenario 2: OpenAI key set, listing succeeds, and allowlist has matches

- Setup: `OPENAI_EMBEDDING_KEY` is valid, `client.models.list()` succeeds, and at least one allowlisted model exists in the returned model set.
- Required output:
  - `GET /ingest/models` returns `200`.
  - `openai.enabled=true`, `openai.status="ok"`, `openai.statusCode="OPENAI_OK"`.
  - OpenAI models in dropdown are exactly allowlisted intersection with available models.
  - Ordering is deterministic: `text-embedding-3-small`, then `text-embedding-3-large`.
- Not allowed:
  - Any non-allowlisted OpenAI model in dropdown.
  - UI needing manual refresh logic beyond normal polling/refresh behavior already used by ingest page.

### Scenario 2b: OpenAI listing succeeds but allowlist has no matches

- Setup: `OPENAI_EMBEDDING_KEY` is valid, `client.models.list()` succeeds, and none of the allowlisted models are present in the returned model set.
- Required output:
  - `GET /ingest/models` returns `200`.
  - LM Studio models are still returned when LM Studio listing works.
  - No OpenAI models appear in dropdown options.
  - `openai.status="warning"` and `openai.statusCode="OPENAI_ALLOWLIST_NO_MATCH"`.
  - `openai.warning.code="OPENAI_ALLOWLIST_NO_MATCH"` and `openai.warning.retryable=false`.
- Not allowed:
  - Treating this case as transient retryable listing failure.
  - Returning non-allowlisted OpenAI model IDs to fill the dropdown.

### Scenario 3: OpenAI key set but model listing fails transiently

- Setup: `OPENAI_EMBEDDING_KEY` is set, OpenAI listing call fails transiently.
- Required output:
  - `GET /ingest/models` returns `200` (not 5xx).
  - LM Studio models are still returned when LM Studio listing works.
  - `openai.status="warning"`, `openai.statusCode="OPENAI_MODELS_LIST_TEMPORARY_FAILURE"`.
  - `openai.warning` contains `code`, `message`, `retryable`, optional `retryAfterMs`.
  - UI shows warning state and still allows LM Studio ingest.
- Not allowed:
  - Full endpoint failure caused only by transient OpenAI listing issue.

### Scenario 4: Backward compatibility with pre-story roots

- Setup: existing root/index metadata only has legacy fields (`lockedModelId`, root `model`) and no provider field.
- Required output:
  - Runtime infers `embeddingProvider="lmstudio"` for lock checks and vector search.
  - Existing repositories continue ingest/re-embed/vector-search without manual migration.
  - Response contracts include canonical fields plus compatibility aliases.
- Not allowed:
  - Forced migration step.
  - Rejection of old roots solely because provider field is absent.

### Scenario 5: Lock conflict behavior

- Setup: index already locked to provider/model A, user attempts ingest with provider/model B.
- Required output:
  - `POST /ingest/start` returns `409` with `code="MODEL_LOCKED"`.
  - Response includes canonical `lock.embeddingProvider`, `lock.embeddingModel`, `lock.embeddingDimensions`.
  - Compatibility alias `lockedModelId` remains present for legacy clients.
- Not allowed:
  - Silent provider/model switch on non-empty index.
  - Ambiguous conflict payloads missing lock identity.

### Scenario 6: OpenAI ingest + OpenAI query parity

- Setup: repository ingested using OpenAI model.
- Required output:
  - Future ingest/re-embed uses same locked provider+model unless index reset by existing lock-reset behavior.
  - `/tools/vector-search` and MCP vector-search paths generate query embedding with same locked provider+model.
  - Dimension mismatch is detected before Chroma query and returned as deterministic error.
- Not allowed:
  - Query embedding provider/model differing from ingest lock.
  - Raw Chroma mismatch errors leaking to client without normalized error mapping.

### Scenario 7: OpenAI failure handling and retries

- Setup: OpenAI embeddings call fails with retryable and non-retryable categories.
- Required output:
  - Retryable errors use bounded backoff with configured defaults.
  - Non-retryable errors fail immediately with normalized error code and user-readable message.
  - Quota/credit exhaustion maps to `OPENAI_QUOTA_EXCEEDED` and `retryable=false`.
- Not allowed:
  - Unclassified/raw SDK errors returned directly.
  - Multiple retry layers competing (SDK retries + server retries) for the same embedding request.

### Story completion gate

- Story is only complete when all scenarios above pass in automated tests and manual verification.
- Story is not complete if behavior works only in one surface; REST, MCP, ingest jobs, and UI lock display must all match the same canonical lock rules.

## Message Contracts & Storage Shapes

### Contract Delta Inventory (Current -> Story 0000036)

- Current runtime contracts (verified from repository code) are model-only on lock-bearing surfaces:
  - `GET /ingest/models` -> `{ models, lockedModelId }`
  - `GET /ingest/roots` -> `{ roots[], lockedModelId }` with per-root legacy `model`
  - `GET /tools/ingested-repos` -> `{ repos[], lockedModelId }` with per-repo legacy `modelId`
  - `POST /ingest/start` lock conflict -> `{ status, code: "MODEL_LOCKED", lockedModelId }`
  - classic MCP `ListIngestedRepositories` output schema -> `{ repos, lockedModelId }` wrapped in text content
- Story 0000036 requires provider-aware lock metadata and therefore changes to existing contracts, not only net-new contracts.
- Required rule for this story: each lock-bearing response above must include canonical lock object fields and keep compatibility aliases during transition.

### Retry Defaults (OpenAI Embedding Calls)

- `maxRetries`: `3` (three retries after initial attempt).
- `baseDelayMs`: `500`.
- `maxDelayMs`: `8000`.
- `jitter`: multiply computed delay by a random factor in `[0.75, 1.0]` (up to 25 percent reduction), aligned with OpenAI SDK behavior.
- Retryable categories remain: `OPENAI_RATE_LIMITED`, `OPENAI_TIMEOUT`, `OPENAI_CONNECTION_FAILED`, `OPENAI_UNAVAILABLE`.
- OpenAI SDK retry ownership contract:
  - OpenAI embeddings client calls in this story set `maxRetries=0`.
  - Server retry utility is the only retry layer for embeddings so timing/telemetry/contracts are deterministic.
  - OpenAI embeddings client timeout default for this story: `30000ms` per attempt (applies before retry utility decides next attempt).
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
    "embeddingModel": "text-embedding-3-small",
    "embeddingDimensions": 1536
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
- `lock` object minimum fields:
  - `embeddingProvider: "lmstudio" | "openai"`
  - `embeddingModel: string`
  - `embeddingDimensions: number`
- `openai.status` values:
  - `disabled`: no `OPENAI_EMBEDDING_KEY` configured.
  - `ok`: key configured and model listing succeeded.
  - `warning`: key configured but OpenAI model listing did not fully succeed.
- `openai.statusCode` values for deterministic UI handling:
  - `OPENAI_DISABLED`
  - `OPENAI_OK`
  - `OPENAI_ALLOWLIST_NO_MATCH`
  - `OPENAI_MODELS_LIST_TEMPORARY_FAILURE`
  - `OPENAI_MODELS_LIST_AUTH_FAILED`
  - `OPENAI_MODELS_LIST_UNAVAILABLE`
- `openai.warning.code` values for this story:
  - `OPENAI_ALLOWLIST_NO_MATCH`
  - `OPENAI_MODELS_LIST_TEMPORARY_FAILURE`
  - `OPENAI_MODELS_LIST_AUTH_FAILED`
  - `OPENAI_MODELS_LIST_UNAVAILABLE`
- `openai.warning` is present only when `openai.status=warning` and omitted for `disabled`/`ok`.
- For the transient failure case requested in this story, use:
  - `code=OPENAI_MODELS_LIST_TEMPORARY_FAILURE`
  - `retryable=true`
  - include LM Studio models as normal; do not fail the whole endpoint.
- Ingest-page info-bar message contract:
  - Missing key: `OpenAI embedding models are unavailable. Set OPENAI_EMBEDDING_KEY on the server to enable them.`
  - Allowlist no-match: `OpenAI is configured, but no supported embedding models are available for this key.`
  - Temporary listing failure: `OpenAI models are temporarily unavailable. LM Studio models are still available.`

### Ingest Start Conflict Contract (Provider-Aware Lock)

- Canonical request shape for starting ingest:

```json
{
  "path": "/absolute/path",
  "name": "My Repo",
  "description": "Optional",
  "embeddingProvider": "openai",
  "embeddingModel": "text-embedding-3-small",
  "dryRun": false
}
```

- Legacy request compatibility:
  - If request contains `model` only and no canonical fields, map to `embeddingProvider="lmstudio"` and `embeddingModel=model`.
  - If request contains canonical fields, ignore legacy `model` for lock decisions.

- When ingest starts with provider/model not matching the existing non-empty lock, response is:

```json
{
  "status": "error",
  "code": "MODEL_LOCKED",
  "lock": {
    "embeddingProvider": "lmstudio",
    "embeddingModel": "text-embedding-qwen3-embedding-4b",
    "embeddingDimensions": 2560
  },
  "lockedModelId": "text-embedding-qwen3-embedding-4b"
}
```

- `lockedModelId` is compatibility-only; canonical clients should use `lock.embeddingProvider` + `lock.embeddingModel`.
- Same logical lock contract applies to re-embed entry points.

### Compatibility Alias Matrix (`lockedModelId`)

- Existing lock-reporting responses keep `lockedModelId` as a compatibility alias mapped from canonical `lock.embeddingModel`:
  - `GET /ingest/models`
  - `GET /ingest/roots`
  - `GET /tools/ingested-repos`
  - `POST /ingest/start` lock conflict
  - classic MCP tool `ListIngestedRepositories`
- New canonical fields are required in these same surfaces (`lock.embeddingProvider`, `lock.embeddingModel`, and where relevant `lock.embeddingDimensions`).

### `/ingest/roots` Contract Update

- Existing response stays backward compatible but adds canonical lock and canonical per-root embedding fields:

```json
{
  "roots": [
    {
      "runId": "run-1",
      "name": "Repo",
      "description": null,
      "path": "/data/repo",
      "embeddingProvider": "openai",
      "embeddingModel": "text-embedding-3-small",
      "embeddingDimensions": 1536,
      "model": "text-embedding-3-small",
      "status": "completed",
      "lastIngestAt": "2026-02-23T10:00:00.000Z",
      "counts": { "files": 10, "chunks": 100, "embedded": 100 },
      "lastError": null
    }
  ],
  "lock": {
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small",
    "embeddingDimensions": 1536
  },
  "lockedModelId": "text-embedding-3-small"
}
```

- `model` remains compatibility-only and maps to `embeddingModel`.
- If canonical per-root fields are missing for historical roots, response infers `embeddingProvider="lmstudio"` and fills canonical fields from legacy metadata.

### `/tools/ingested-repos` + Classic MCP `ListIngestedRepositories` Contract Update

- Existing repo list response keeps compatibility aliases but adds canonical embedding fields:

```json
{
  "repos": [
    {
      "id": "Repo",
      "containerPath": "/data/repo",
      "hostPath": "/host/repo",
      "embeddingProvider": "openai",
      "embeddingModel": "text-embedding-3-small",
      "embeddingDimensions": 1536,
      "modelId": "text-embedding-3-small",
      "counts": { "files": 10, "chunks": 100, "embedded": 100 },
      "lastError": null
    }
  ],
  "lock": {
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small",
    "embeddingDimensions": 1536
  },
  "lockedModelId": "text-embedding-3-small"
}
```

- Classic MCP `ListIngestedRepositories` tool output schema must be updated to the same inner JSON shape above (still wrapped as `result.content[0].text`).
- `modelId` remains compatibility-only and maps to `embeddingModel`.

### `/tools/vector-search` Contract Extension

- Success payload shape remains unchanged for retrieval results unless/until follow-up story requires provider fields on every match.
- Error contract extends to include OpenAI embedding failures when locked provider is `openai`, while preserving existing current errors:
  - Existing preserved errors: `VALIDATION_FAILED`, `REPO_NOT_FOUND`, `INGEST_REQUIRED`, `EMBED_MODEL_MISSING`, `CHROMA_UNAVAILABLE`.
  - Added OpenAI failures from this story taxonomy (`OPENAI_*`) with `retryable` and optional `retryAfterMs`.
- New deterministic dimension mismatch error is required before Chroma query dispatch:
  - `error=EMBEDDING_DIMENSION_MISMATCH`
  - includes expected and actual dimensions.

### OpenAI Embedding Failure Response Contract

- For ingest and vector-search OpenAI embedding failures, normalized payload must include:
  - `error: string` (taxonomy code listed in this plan, e.g. `OPENAI_QUOTA_EXCEEDED`)
  - `message: string` (user-readable)
  - `retryable: boolean`
  - `provider: "openai"`
  - `upstreamStatus?: number`
  - `retryAfterMs?: number`
- Quota/credits exhaustion must map to `OPENAI_QUOTA_EXCEEDED` with `retryable=false`.

### OpenAI Embedding Request Guardrails

- Request guardrails for OpenAI provider:
  - `input` array length <= `2048`.
  - Per-input token length <= selected model input limit.
  - Total input tokens per request <= `300000`.
- If an input/request exceeds limits before calling OpenAI, server returns deterministic validation failure using `OPENAI_INPUT_TOO_LARGE`.
- Guardrails apply to ingest-time embedding calls and query-time embedding calls.

### Canonical Storage Shapes (Option A + Backward Compatibility)

- Chroma/root canonical lock fields:
  - `embeddingProvider: "lmstudio" | "openai"`
  - `embeddingModel: string`
  - `embeddingDimensions: number`
- Canonical write shape is required in both vectors metadata and root metadata after new ingest/re-embed.
- Storage keys for this story:
  - vectors collection metadata: `embeddingProvider`, `embeddingModel`, `embeddingDimensions`
  - root metadata (per root row): `embeddingProvider`, `embeddingModel`, `embeddingDimensions`
- Legacy read compatibility remains mandatory:
  - If canonical fields are missing, read legacy `lockedModelId` and legacy root `model`.
  - Infer `embeddingProvider="lmstudio"` when provider is missing.
- New writes (ingest/re-embed) persist canonical fields only.

## Edge Cases and Failure Modes

This section defines additional failure-mode expectations that must be implemented and tested before story completion.

### Provider Discovery and Availability

- Edge case: `OPENAI_EMBEDDING_KEY` exists but is blank/whitespace only at runtime. Required handling: treat OpenAI as disabled (`openai.enabled=false`, `openai.status="disabled"`, `openai.statusCode="OPENAI_DISABLED"`), and do not attempt OpenAI client calls.
- Edge case: LM Studio listing fails while OpenAI listing succeeds. Required handling: return `200` with available OpenAI models plus explicit LM Studio warning state in response payload; do not fail whole `/ingest/models`.
- Edge case: both LM Studio and OpenAI model listing fail. Required handling: return `200` with empty `models` plus deterministic provider warning states so UI can render actionable recovery guidance instead of failing silently.
- Edge case: OpenAI model list succeeds but selected lock model is no longer available for the key/org. Required handling: ingest/reembed/vector-search fail deterministically with `OPENAI_MODEL_UNAVAILABLE`; never auto-switch to another model.
- Edge case: same model id string exists under different providers. Required handling: all selection, locking, and contract payloads use provider-qualified identity; model id alone is never treated as globally unique.

### Lock Metadata Integrity and Compatibility

- Edge case: lock metadata source divergence (`/ingest/models` placeholder lock module vs Chroma lock metadata in other paths). Required handling: all lock reads come from one canonical resolver; no endpoint-specific placeholder lock readers.
- Edge case: canonical fields partially present (for example `embeddingProvider` set but `embeddingModel` missing). Required handling: treat as invalid lock metadata and return deterministic server validation error; do not silently guess missing canonical fields.
- Edge case: legacy-only metadata (`lockedModelId`, root `model`, repo `modelId`) across existing roots. Required handling: dual-read compatibility remains mandatory (`provider=lmstudio` inference when provider missing), while new writes always persist canonical provider/model/dimension fields.
- Edge case: compatibility alias drift (`lockedModelId` not equal to `lock.embeddingModel`). Required handling: alias must always mirror canonical model value for every lock-bearing response surface.
- Edge case: vectors collection emptied by remove/cancel cleanup but stale lock metadata remains. Required handling: lock-clearing is idempotent and guaranteed when vectors are empty, without clearing a newly established lock from another run.

### Concurrency and State Transitions

- Edge case: race window in `POST /ingest/start` prechecks (`getLockedModel` + `collectionIsEmpty` + `isBusy`) before `startIngest` lock acquisition. Required handling: `startIngest` remains the authoritative atomic gate; rejected starts must never create queued runs.
- Edge case: ingest lock TTL expires while a run is still non-terminal. Required handling: busy decision uses active run state plus lock state; mutating endpoints must reject while any non-terminal run exists.
- Edge case: canceling a terminal run while lock ownership is still present. Required handling: cancel path must release stale ingest lock ownership to prevent false `BUSY`.
- Edge case: concurrent remove/reembed/start operations against same root. Required handling: remove/reembed mutations must honor same ingest lock discipline and return deterministic `BUSY` conflicts when lock is held.
- Edge case: reembed requested while latest root state is `cancelled`/`error` with stale metadata. Required handling: deterministic eligibility check before reembed start; reject invalid states with stable validation error.

### OpenAI Request/Retry Failure Modes

- Edge case: retryable OpenAI failures include `retry-after-ms`, `retry-after`, or rate-limit reset headers that are invalid/negative/unparseable. Required handling: ignore invalid hints and fall back to bounded exponential delay contract.
- Edge case: retry hint is excessively long (greater than 60s). Required handling: treat as non-immediate and use bounded fallback delay to avoid long blocking requests.
- Edge case: retry budget exhausted after transient failures. Required handling: return final normalized `OPENAI_*` terminal error containing retryability metadata and last-known upstream status.
- Edge case: OpenAI SDK retries left enabled while server retries are also enabled. Required handling: enforce one retry layer only (`maxRetries=0` in SDK client for embeddings calls).
- Edge case: timeout/connection resets during ingest after partial chunk batches were written. Required handling: run fails with deterministic OpenAI taxonomy code and preserves accurate progress/lastError; no silent provider fallback.

### Embedding Input/Output Validation

- Edge case: ingest batching exceeds OpenAI array/token limits (`>2048` inputs, `>300000` total tokens). Required handling: preflight split/reject deterministically before upstream call.
- Edge case: token estimation underestimates and OpenAI still returns input-too-large errors. Required handling: map upstream response deterministically to `OPENAI_INPUT_TOO_LARGE` with non-retryable classification.
- Edge case: embedding response contains empty vectors or non-numeric payloads. Required handling: fail fast as deterministic provider-response validation error; do not write corrupted vectors.
- Edge case: query embedding dimension differs from locked collection dimension (validated by Chroma docs as error condition). Required handling: detect mismatch before Chroma query and return `EMBEDDING_DIMENSION_MISMATCH` including expected/actual dimensions.

### Contract and Surface Parity

- Edge case: REST and classic MCP surfaces map equivalent failures to different error codes/messages. Required handling: shared error mapping table across `/tools/vector-search`, classic MCP `VectorSearch`, and related ingest lock errors.
- Edge case: classic MCP output schema regressions when adding provider-aware fields. Required handling: preserve existing JSON-RPC envelope and compatibility fields while adding canonical fields as backward-compatible extensions.
- Edge case: stale selected model in Ingest UI after models refresh removes that option. Required handling: UI clears invalid selection deterministically and surfaces provider-specific info/warning state instead of submitting stale value.
- Edge case: secret leakage in logs/contracts (`OPENAI_EMBEDDING_KEY` accidentally emitted). Required handling: key never appears in responses, logs, or error payloads; only boolean capability/status metadata is exposed.

## Implementation Ideas

This is a rough implementation sequence only (not tasking). It reflects current repository architecture checks plus external SDK/DB behavior research.

1. Establish one canonical embedding lock/service abstraction.
- Create a shared embedding provider layer under `server/src/ingest/` with explicit provider identity and methods for model list, embed, and token counting.
- Implement provider adapters for LM Studio and OpenAI.
- Introduce one canonical lock object shape (`embeddingProvider`, `embeddingModel`, `embeddingDimensions`) and central lock read/write helpers.
- Primary files: `server/src/ingest/chromaClient.ts`, `server/src/ingest/ingestJob.ts`, `server/src/ingest/modelLock.ts` (remove/repurpose), new provider files under `server/src/ingest/`.

2. Unify lock-source behavior before any UI/API contract expansion.
- Ensure all lock consumers call the same canonical lock resolver.
- Remove split behavior where `/ingest/models` reads placeholder lock logic while ingest/vector paths read Chroma lock metadata.
- Primary files: `server/src/routes/ingestModels.ts`, `server/src/routes/ingestStart.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/lmstudio/toolService.ts`.

3. Add provider-aware request parsing with backward compatibility.
- Support canonical ingest start input fields (`embeddingProvider`, `embeddingModel`) while retaining legacy `model` input mapping to LM Studio.
- Apply the same canonical interpretation in re-embed paths.
- Primary files: `server/src/routes/ingestStart.ts`, `server/src/routes/ingestReembed.ts`, `server/src/ingest/reingestService.ts`, shared validation/parser helper under `server/src/ingest/`.

4. Make metadata writes canonical while keeping legacy reads.
- Persist canonical provider/model/dimension lock metadata on new ingest/re-embed writes.
- Continue reading legacy model-only metadata and infer `provider=lmstudio` when provider metadata is absent.
- Keep compatibility alias fields (`lockedModelId`) in current response surfaces.
- Primary files: `server/src/ingest/chromaClient.ts`, `server/src/ingest/ingestJob.ts`, `server/src/routes/ingestModels.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`, `server/src/lmstudio/tools.ts`.

5. Integrate OpenAI embedding execution with explicit retry ownership.
- Implement OpenAI embedding calls via official SDK using `OPENAI_EMBEDDING_KEY`.
- Disable SDK-level retries for these calls (`maxRetries=0`) and use one shared server retry utility with existing bounded backoff contract.
- Keep deterministic mapping for OpenAI taxonomy codes across ingest and vector-search flows.
- Primary files: new OpenAI provider adapter under `server/src/ingest/`, `server/src/ingest/ingestJob.ts`, `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsVectorSearch.ts`.

6. Enforce request guardrails and dimension safety.
- Add OpenAI request guards (`<=2048` inputs per request, `<=300000` total tokens per request, per-input token limits).
- Persist and validate `embeddingDimensions`; fail deterministically before issuing a Chroma query when dimensions do not match lock metadata.
- Primary files: OpenAI provider adapter/utilities under `server/src/ingest/`, `server/src/ingest/chromaClient.ts`, `server/src/lmstudio/toolService.ts`.

7. Add environment loading parity for local and docker startup.
- Update server bootstrap to load `.env.local` and `.env` deterministically (same practical behavior as docker compose env files) so `OPENAI_EMBEDDING_KEY` is predictable in local non-docker runs.
- Primary files: `server/src/index.ts` and related startup/env notes in docs.

8. Expand model-listing contracts and ingest UI behavior.
- Update `/ingest/models` contract to include provider-tagged model options and explicit OpenAI availability/warning state.
- Keep stable lock compatibility alias while surfacing canonical lock object.
- Update Ingest UI hooks/components to render provider-tagged options and the required info/warning bars.
- Primary files: `server/src/routes/ingestModels.ts`, `client/src/hooks/useIngestModels.ts`, `client/src/components/ingest/IngestForm.tsx`, `client/src/pages/IngestPage.tsx`, `client/src/hooks/useIngestRoots.ts`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/RootDetailsDrawer.tsx`.

9. Align REST, MCP, and schema/docs surfaces.
- Update lock-related payloads for existing surfaces while keeping compatibility fields.
- Keep classic MCP `ListIngestedRepositories` and related outputs consistent with canonical+alias contract.
- Update API documentation/schema artifacts accordingly.
- Primary files: `server/src/mcp/server.ts`, `server/src/lmstudio/tools.ts`, `server/src/openapi.json`.

10. Update validation-focused tests before implementation completion.
- Server lock/contract tests: ingest start/reembed/models/roots and lock-state unit tests.
- Vector-search parity tests: provider-aware lock usage, missing-lock behavior, dimension mismatch behavior.
- Client ingest UI tests: provider-tagged model dropdown, info/warning states, lock-display compatibility behavior.
- Primary suites: `server/src/test/unit/*ingest*.test.ts`, `server/src/test/unit/tools-vector-search.test.ts`, `server/src/test/unit/chroma-embedding-selection.test.ts`, `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`, `client/src/test/ingest*.test.tsx`, `client/src/test/ingestForm.test.tsx`, `e2e/ingest.spec.ts`, `e2e/chat-tools.spec.ts`.
