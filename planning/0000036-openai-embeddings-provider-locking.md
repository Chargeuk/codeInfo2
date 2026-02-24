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
- Embedding input constraints in OpenAI API reference include: per-model max input tokens, max 2048 inputs per request array, and max 300,000 total input tokens across a single request. Implementation must treat token limits as model-specific and avoid hard-coding one global token limit for every embedding model.
- `dimensions` is supported for `text-embedding-3-small` (1..1536) and `text-embedding-3-large` (1..3072). This story keeps default dimensions only (no UI control, no request override).

Version and dependency baseline for this story (validated from repository lockfile + docs):

- Resolved server/runtime versions in this repo: `express@5.1.0`, `dotenv@16.6.1`, `chromadb@3.1.6`, `mongoose@9.0.1`, `typescript@5.9.3`.
- Resolved client/runtime versions in this repo: `react@19.2.0`, `@mui/material@6.5.0` (manifest range is `^6.4.1`).
- OpenAI SDK state before implementing this story: `openai` npm package is not currently installed; only `@openai/codex-sdk` is present and used for Codex chat interfaces, not embeddings/models APIs.
- Consequence: this story must add and use the official `openai` SDK in server runtime for embeddings/model discovery; `@openai/codex-sdk` is not the OpenAI embeddings adapter for this story.

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
- `GET /ingest/models` returns `200` with a deterministic contract containing `models`, `lock`, `openai`, and `lmstudio` objects (defined below), even when one provider model-list call fails.
- `GET /ingest/models` includes LM Studio models whenever LM Studio listing succeeds; transient OpenAI listing failures do not fail the whole endpoint.
- If LM Studio listing fails while OpenAI listing succeeds, `lmstudio.status` is `warning`, OpenAI options still render, and the endpoint remains `200`.
- If both LM Studio and OpenAI listing fail, `/ingest/models` still returns `200` with deterministic warning envelopes and an empty `models` array.
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
- Break-step parsing in flow execution is robust to non-strict wrapper text while remaining schema-strict: parse order is strict JSON body first, then fenced JSON extraction, then balanced JSON-object candidate scanning; only `{ "answer": "yes" | "no" }` is accepted.
- Failed command steps and failed flow execution steps retry with a default max-attempt budget of `5` total attempts, overridable via `FLOW_AND_COMMAND_RETRIES`; abort/stopped paths are never retried.
- Tests cover all acceptance behaviors above, including: missing-key UI info state, transient model-list warning state, allowlist enforcement, canonical+legacy lock handling, provider/model lock conflicts, vector-search provider parity, OpenAI failure mapping, and retry behavior.

### Out Of Scope

- Adding OpenAI as a chat/completions provider in this story (this story is embeddings-only).
- Adding runtime UI fields for directly entering/storing secrets in the browser.
- Multi-provider mixed-vector indexes (no mixing LM Studio and OpenAI vectors in one locked index).
- Reworking unrelated chat/agent/flow provider-selection behavior.
- Any changes to Codex provider flows unrelated to embedding architecture.

### Questions

- None. All planning questions are resolved and converted into concrete implementation requirements below.

## Resolved Findings (Questions Closed)

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
- Confirmed from dependency inspection that `openai` SDK is not currently installed in the server workspace while this story requires OpenAI embeddings/model-list APIs. This plan now explicitly requires adding the official `openai` package before implementing OpenAI adapter logic.
- Confirmed from dependency inspection that client resolves `@mui/material@6.5.0` while MUI MCP mirror docs available in this environment are `6.4.12`; this plan now requires using the MUI MCP mirror plus MUI release/migration docs to ensure no 6.5-specific deprecation regressions.
- Confirmed from repository test configuration that Cucumber step definitions are loaded from `server/src/test/steps/**/*.ts` (not `server/src/test/features/step-definitions/*`); all BDD subtasks in this plan must use the `server/src/test/steps/` path.
- Confirmed from repository feature files that `server/src/test/features/ingest-manage.feature` does not exist; manage-flow scenarios are currently implemented in `ingest-remove.feature` and `ingest-cancel.feature` backed by `server/src/test/steps/ingest-manage.steps.ts`.
- Confirmed from repository runtime consumers that MCP v2 (`server/src/mcp2/tools/codebaseQuestion.ts` + `server/src/chat/responders/McpResponder.ts`) and Chat/Agents tool-result renderers (`client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`) consume `modelId` payloads. This plan now requires explicit compatibility subtasks/tests so canonical lock field rollout does not regress those surfaces.

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
  - Fallback to bounded exponential delay when no valid hint is available.

### `/ingest/models` Warning-State Message Contract

- Response shape includes explicit lock and provider status envelopes so UI state is deterministic:

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
  "lmstudio": {
    "status": "ok",
    "statusCode": "LMSTUDIO_OK"
  },
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
- `lmstudio.status` values:
  - `ok`: LM Studio listing succeeded.
  - `warning`: LM Studio listing failed or returned unusable data for model selection.
- `lmstudio.statusCode` values for deterministic UI handling:
  - `LMSTUDIO_OK`
  - `LMSTUDIO_MODELS_LIST_TEMPORARY_FAILURE`
  - `LMSTUDIO_MODELS_LIST_UNAVAILABLE`
- `lmstudio.warning` is present only when `lmstudio.status=warning`, with:
  - `code: string`
  - `message: string`
  - `retryable: boolean`
  - `retryAfterMs?: number`
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
  - LM Studio listing failure (OpenAI available): `LM Studio embedding models are temporarily unavailable. OpenAI models are still available.`
  - Both provider listings failed: `Embedding model discovery is temporarily unavailable for LM Studio and OpenAI.`

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
- Edge case: canceling a terminal run while lock ownership is still present. Required handling: cancel path must release stale ingest lock ownership to prevent false `BUSY`.
- Edge case: concurrent remove/reembed/start operations against same root. Required handling: remove/reembed mutations must honor same ingest lock discipline and return deterministic `BUSY` conflicts when lock is held.
- Edge case: reembed requested while latest root state is `cancelled`/`error` with stale metadata. Required handling: deterministic eligibility check before reembed start; reject invalid states with stable validation error.

### OpenAI Request/Retry Failure Modes

- Edge case: retryable OpenAI failures include `retry-after-ms` or `retry-after` headers that are invalid/negative/unparseable. Required handling: ignore invalid hints and fall back to bounded exponential delay contract.
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
- Primary files: `server/src/mcp/server.ts`, `server/src/lmstudio/tools.ts`, `openapi.json`.

10. Update validation-focused tests before implementation completion.
- Server lock/contract tests: ingest start/reembed/models/roots and lock-state unit tests.
- Vector-search parity tests: provider-aware lock usage, missing-lock behavior, dimension mismatch behavior.
- Client ingest UI tests: provider-tagged model dropdown, info/warning states, lock-display compatibility behavior.
- Primary suites: `server/src/test/unit/*ingest*.test.ts`, `server/src/test/unit/tools-vector-search.test.ts`, `server/src/test/unit/chroma-embedding-selection.test.ts`, `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`, `client/src/test/ingest*.test.tsx`, `client/src/test/ingestForm.test.tsx`, `e2e/ingest.spec.ts`, `e2e/chat-tools.spec.ts`.

## Reuse-First Constraints (Validated via `code_info` + Manual Search)

- Reuse existing lock helpers in `server/src/ingest/chromaClient.ts` (`getLockedModel`, `setLockedModel`, `clearLockedModel`, `resolveLockedEmbeddingFunction`) and extend them for canonical provider-aware lock metadata. Do not introduce a second lock storage/resolution path.
- Remove route dependency on placeholder `server/src/ingest/modelLock.ts`; canonical lock reads must come from the same runtime lock resolver used by ingest/vector-search internals.
- Keep vector-search behavior centralized in `server/src/lmstudio/toolService.ts` (`validateVectorSearch`, `vectorSearch`, `listIngestedRepositories`) and reuse existing route/MCP adapters in `server/src/routes/toolsVectorSearch.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`, and `server/src/lmstudio/tools.ts`.
- Reuse existing retry utility semantics by extracting from `server/src/agents/retry.ts` into shared utility form (with compatibility export), rather than introducing a separate retry framework for embeddings.
- Reuse existing env/config parsing style from `server/src/config/chatDefaults.ts`, `server/src/config/codexEnvDefaults.ts`, `server/src/ingest/config.ts`, and `server/src/logger.ts` (`parseNumber`) for deterministic env handling and warnings.
- Reuse existing client normalization patterns from `client/src/hooks/useConversations.ts` and `client/src/hooks/useConversationTurns.ts` when adapting ingest contracts.
- Reuse existing warning/info banner implementation and test patterns (`client/src/pages/ChatPage.tsx`, `client/src/test/chatPage.codexBanners.test.tsx`) for new ingest provider warning states.
- Prefer extending existing tests before creating new suites:
  - server: `tools-vector-search`, `chroma-embedding-selection`, `tools-ingested-repos`, ingest Cucumber steps/features, MCP integration, flows/agent contract consumers.
  - client: `ingestForm`, `ingestRoots`, `ingestStatus`, and banner-pattern tests.

# Implementation Plan

## Instructions

This section defines how implementation tasks must be executed once development starts.

1. Read and fully understand the story sections above before changing code.
2. Work through tasks in strict order; do not skip ahead.
3. Before touching code for a task, set that task status to `__in_progress__`, commit, and push.
4. Complete each subtask in order and run the listed tests before moving to the next subtask group.
5. Keep contract changes server-first. Frontend work that depends on message/shape changes must start only after the related server contract task is complete.
6. Keep legacy compatibility behavior in place while introducing canonical provider-aware fields.
7. After finishing a task, update Implementation notes and Git Commits, set status to `__done__`, and push.
8. Do not start final verification until all implementation tasks are complete.
9. Treat every subtask as standalone work for a junior developer: each subtask must explicitly state target files, contract constraints, and at least one documentation/source link even if repeated from other sections.
10. `Documentation Locations` entries must reference external documentation only (official docs, Context7, DeepWiki). Do not reference repository source files or local project docs in that section.

## Tasks

### 1. Server: Refactor LM Studio embedding flow behind a shared provider interface (parity only)

- Task Status: **__done__**
- Git Commits: `be6470e`, `7a1b0f7`, `5eb9e73`, `c2ab615`, `cccf011`

#### Overview

Refactor existing LM Studio embedding calls into a common provider interface without changing runtime behavior. This task proves LM Studio ingest/vector-search behavior is unchanged before any OpenAI-specific functionality is introduced.

#### Documentation Locations

- OpenAI Node SDK: Context7 `/openai/openai-node/v6_1_0` (use for provider-adapter method signatures, timeout/retry options, and error object behavior while preserving LM Studio parity).
- Chroma docs: Context7 `/chroma-core/chroma` (use for collection/query behavior and embedding-dimension parity constraints).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating `design.md` diagrams for this task's architecture changes).
- TypeScript handbook: https://www.typescriptlang.org/docs/ (use for provider interfaces, module boundaries, and strict typing patterns).
- Express routing guide: https://expressjs.com/en/guide/routing.html (use to confirm route behavior remains unchanged during internal refactor).
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification (use to confirm classic MCP payloads are unchanged).
- Jest: Context7 `/jestjs/jest` (use for parity/regression test updates without changing assertion semantics).

#### Subtasks

1. [x] Record LM Studio baseline behavior before refactor. Files (read/edit): `server/src/ingest/ingestJob.ts`, `server/src/ingest/chromaClient.ts`, `server/src/lmstudio/toolService.ts`. Required behavior: document exact pre-change call chain for ingest embeddings, query embeddings, and lock reads/writes in this task's Implementation notes, including function names and payload shape so parity can be asserted after refactor. Docs: https://www.typescriptlang.org/docs/ and Context7 `/chroma-core/chroma`.
2. [x] Add shared provider contracts for embedding/model-list operations. Files (read/edit): create or extend `server/src/ingest/providers/*` (contract/type files only in this subtask). Required behavior: define one provider interface containing provider id, embedding call, and model discovery method; no provider-specific branching outside adapters. Docs: https://www.typescriptlang.org/docs/handbook/2/objects.html.
3. [x] Implement LM Studio adapter against the shared provider contract. Files (read/edit): `server/src/ingest/providers/*`, plus existing LM Studio embedding utility files currently called by ingest/vector paths. Required behavior: adapter output must preserve current vector values and error behavior; do not introduce OpenAI behavior in this subtask. Docs: Context7 `/chroma-core/chroma`.
4. [x] Switch core ingest/vector embedding call sites to use the LM Studio adapter. Files (read/edit): `server/src/ingest/ingestJob.ts`, `server/src/ingest/chromaClient.ts`, `server/src/lmstudio/toolService.ts`. Required behavior: keep single execution flow through existing `getVectorsCollection({ requireEmbedding: true })` and `vectorSearch(...)`; do not duplicate vector-search logic. Docs: Context7 `/chroma-core/chroma` and https://www.typescriptlang.org/docs/.
5. [x] Preserve all existing route/tool contracts during this refactor-only task. Files (read/edit): `server/src/routes/*`, `server/src/mcp/server.ts` (read-only verification unless a compile fix is required). Required behavior: no response schema or status code changes are allowed in Task 1; this subtask fails if any route/tool contract diff is introduced. Docs: https://expressjs.com/en/guide/routing.html and https://www.jsonrpc.org/specification.
6. [x] Add parity test for ingest embedding selection after adapter refactor. Test type: Unit (Jest). Location: `server/src/test/unit/chroma-embedding-selection.test.ts`. Description: assert the same LM Studio provider/model selection and embedding call-path output before and after adapter wiring. Purpose: prevent ingest embedding regressions during provider-interface extraction. Files (read/edit): `server/src/test/unit/chroma-embedding-selection.test.ts`. Docs: https://jestjs.io/docs/getting-started.
7. [x] Add parity test for REST vector-search embedding behavior after adapter refactor. Test type: Unit (Jest). Location: `server/src/test/unit/tools-vector-search.test.ts`. Description: assert `/tools/vector-search` still uses the same embedding source and returns unchanged success payload shape after adapter wiring. Purpose: ensure vector-search behavior is refactor-safe. Files (read/edit): `server/src/test/unit/tools-vector-search.test.ts`. Docs: https://jestjs.io/docs/getting-started.
8. [x] Add parity test for classic MCP vector-search embedding behavior after adapter refactor. Test type: Unit (Jest). Location: `server/src/test/unit/mcp-vector-search.test.ts`. Description: assert classic MCP `VectorSearch` still uses the same embedding behavior and response shape after adapter wiring. Purpose: keep REST and classic MCP parity intact during refactor-only work. Files (read/edit): `server/src/test/unit/mcp-vector-search.test.ts`. Docs: https://jestjs.io/docs/getting-started.
9. [x] Update markdown document `design.md` for Task 1 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: record shared provider interface wiring, LM Studio adapter flow, and unchanged route/tool contract flow using Mermaid diagrams that match implementation. Files (read/edit): `design.md`, plus Task 1 implementation files for verification (`server/src/ingest/ingestJob.ts`, `server/src/ingest/chromaClient.ts`, `server/src/lmstudio/toolService.ts`, `server/src/ingest/providers/*`). Docs: Context7 `/mermaid-js/mermaid` and https://www.typescriptlang.org/docs/.
10. [x] Add structured parity logs for provider-interface refactor. Files (read/edit): `server/src/ingest/ingestJob.ts`, `server/src/ingest/chromaClient.ts`, `server/src/lmstudio/toolService.ts`, and provider adapter files under `server/src/ingest/providers/`. Required log lines: `DEV-0000036:T1:embedding_adapter_path_selected` (expected `provider=lmstudio`, `path=adapter`) and `DEV-0000036:T1:embedding_adapter_parity_verified` (expected `vectorCount`/`dimension` parity metadata with `parity=true`). Purpose: provide deterministic evidence that adapter wiring runs without behavior drift.
11. [x] Update markdown document `projectStructure.md` for Task 1 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 1 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 1 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `server/src/ingest/providers/*` (new shared provider contract/adapter files from subtasks 2-3) and `server/src/test/unit/mcp-vector-search.test.ts` (if created in subtask 8). Removed files: `None planned`.
12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: exercise ingest + vector-search from `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T1:embedding_adapter_path_selected` with `provider=lmstudio` and `DEV-0000036:T1:embedding_adapter_parity_verified` with `parity=true`. Expected outcome: both logs appear for the exercised flow and browser debug console has zero errors.
9. [x] `npm run compose:down`

10. [x] `npm run test:unit --workspace server`
11. [x] Confirm `server/src/test/unit/chroma-embedding-selection.test.ts` still passes.
12. [x] Confirm `server/src/test/unit/tools-vector-search.test.ts` still passes.

#### Implementation notes

- Baseline behavior (pre-refactor) for Task 1:
  - Ingest-time embedding path: `startIngest` in `server/src/ingest/ingestJob.ts` calls `embedText(model, chunk.text)` in the file write loop after chunking by `chunkText(file.text, await modelClient.embedding.model(model), ...)`; `embedText` directly resolves `deps.lmClientFactory(deps.baseUrl)`, calls `client.embedding.model(modelKey)`, then `model.embed(text)`. Vector writes occur in `flushBatch()` via `vectors.add(...)`; when first real write occurs and no existing lock exists, `setLockedModel(model)` persists `lockedModelId` in collection metadata.
  - Query-time embedding path: `vectorSearch()` in `server/src/lmstudio/toolService.ts` resolves `lockedModelId` via injected `getLockedModel()`, validates repo + filter, then calls `getVectorsCollection({ requireEmbedding: true })`. In `getVectorsCollection`, `resolveLockedEmbeddingFunction()` reads lock metadata via `getLockedModel()`, verifies `LMSTUDIO_BASE_URL`, instantiates LM Studio client via `lmClientResolver`, verifies model exists with `client.embedding.model(lockedModelId)`, then returns `LmStudioEmbeddingFunction` where each query embedding calls `model.embed(text)`.
  - Lock/writes: `getLockedModel()` in `server/src/ingest/chromaClient.ts` reads collection metadata key `lockedModelId`; `setLockedModel(modelId)` writes it. `resolveLockedEmbeddingFunction` throws `IngestRequiredError` when lock is missing and `EmbedModelMissingError` when model lookup fails.
  - /tools/vector-search contract pre-refactor remains unchanged (`validateVectorSearch` + `vectorSearch` route/tool result containing `results`, `modelId`, and `files`; query uses `queryTexts: [query]`, optional `where` and `nResults`).
- Task 1 gotchas and implementation decisions:
  - `npm run e2e` completed successfully with all 42 tests passing in ~48s after Task 1 refactor.
  - `npm run compose:build` succeeded and rebuilt both `codeinfo2-server` and `codeinfo2-client` images.
  - Manual Playwright-MCP check completed against `http://host.docker.internal:5001`: ingest + vector-search flow executed, `DEV-0000036:T1:embedding_adapter_path_selected` and `DEV-0000036:T1:embedding_adapter_parity_verified` appeared in `logs/server.1.log`, and browser console reported no errors during the check.
  - Preserve lock behavior unchanged while refactoring: no lock-model migration or schema changes were introduced in this task; ingest still stores and reads `lockedModelId` via existing metadata.
  - Centralization is provider-first: all LM Studio embedding access now flows through `createLmStudioEmbeddingProvider` in `server/src/ingest/providers/` to avoid future provider branching.
  - Route/tool contracts stay untouched: no contract edits were made to MCP/REST payload fields in this task; only internal wiring changed.
  - `ProviderEmbeddingModel` decouples chunker/token-counting/context-length from LM SDK types, enabling future provider extension.
  - Added `DEV-0000036:T1:embedding_adapter_path_selected` and `DEV-0000036:T1:embedding_adapter_parity_verified` emission points for both ingest and query paths to satisfy mandatory manual verification.
  - `npm run lint --workspaces` and `npm run format:check --workspaces` now pass with warnings only in unrelated pre-existing files; no Task 1 code changes required.
  - `npm run build --workspace server` passes after Task 1 refactor changes.
- `npm run build --workspace client` passes with Vite build output (large-chunk warning only).
- `npm run test --workspace client` completed with all 90 suites passing in this task step, with only baseline log output/mermaid warnings and no Task 1 regressions.
- `npm run test --workspace server` currently exits non-zero due 4 unrelated failures:
  - `POST /chat` defaults assertions in `server/src/test/integration/chat-codex-mcp.test.ts` still expect legacy defaults (`on-failure`, `xhigh`) instead of current `never`/`xhigh`.
  - `MCP responder` and `codebaseQuestion` happy-path tests in `server/src/test/integration/mcp-codex-wrapper.test.ts` and `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` still assert model `gpt-5.3-codex` while runtime now emits `gpt-5.3-codex-spark`.
  - Failures are baseline regressions pre-dating Task 1 and were not introduced by Task 1 refactor.
- `npm run test:unit --workspace server` was re-run now; it still fails with the same 4 baseline failures above, with totals `tests: 628`, `pass: 624`, `fail: 4` and exit code 1.
- `server/src/test/unit/chroma-embedding-selection.test.ts` and `server/src/test/unit/tools-vector-search.test.ts` both pass after Task 1 refactor, with 4/4 and 25/25 passing respectively when run directly in isolation with the same TS loader/env setup.

---

### 2. Server: Unify lock resolution source and remove placeholder lock path

- Task Status: **__done__**
- Git Commits: `4b64c72`, `8b7f31e`

#### Overview

Make one canonical lock resolver for all lock consumers so `/ingest/models` no longer diverges from ingest/vector paths. This task is internal consistency work and should not yet change public contracts.

#### Documentation Locations

- Chroma docs: Context7 `/chroma-core/chroma` (use for metadata and lock-state persistence semantics across collection reads/writes).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating `design.md` diagrams for lock-source unification).
- Express error handling: https://expressjs.com/en/guide/error-handling.html (use for deterministic route-level error envelopes during resolver unification).
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification (use for MCP lock-surface contract parity).
- OpenAPI 3.0.3: https://spec.openapis.org/oas/v3.0.3.html (use for existing REST schema stability while internal lock source changes).
- TypeScript modules handbook: https://www.typescriptlang.org/docs/handbook/modules/introduction.html (use for import-path cleanup and single-source resolver wiring).
- Jest: Context7 `/jestjs/jest` (use for endpoint lock-parity regression tests).

#### Subtasks

1. [x] Introduce one canonical lock resolver module used by all lock readers. Files (read/edit): `server/src/ingest/chromaClient.ts`, `server/src/ingest/modelLock.ts` (deprecate/forward/remove usage). Required behavior: all lock reads in runtime code must resolve through exactly one source of truth. Docs: Context7 `/chroma-core/chroma`.
2. [x] Rewire lock consumers to the canonical resolver. Files (read/edit): `server/src/routes/ingestModels.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/routes/ingestStart.ts`, `server/src/lmstudio/toolService.ts`, `server/src/mcp/server.ts`. Required behavior: each surface must read identical lock values for the same index state. Docs: https://expressjs.com/en/guide/error-handling.html and https://www.jsonrpc.org/specification.
3. [x] Remove direct placeholder-lock imports from routes/tools after rewiring. Files (read/edit): all files touched in subtask 2 plus `server/src/ingest/modelLock.ts`. Required behavior: no route/tool may import the placeholder path directly after this step; keep compiler clean. Docs: https://www.typescriptlang.org/docs/handbook/modules/introduction.html.
4. [x] Keep lock payload contract unchanged in Task 2. Files (read/edit): `server/src/routes/ingestModels.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`. Required behavior: continue returning existing `lockedModelId` and current payload layout until later message-contract tasks. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.jsonrpc.org/specification.
5. [x] Add lock-parity test for `/ingest/models` canonical lock source wiring. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-models.test.ts`. Description: assert the reported lock value comes from the unified resolver and matches fixture state. Purpose: prevent `/ingest/models` drift from runtime lock state. Files (read/edit): `server/src/test/unit/ingest-models.test.ts`. Docs: https://jestjs.io/docs/getting-started.
6. [x] Add lock-parity test for `/ingest/roots` against the unified lock resolver. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-roots-dedupe.test.ts`. Description: assert `/ingest/roots` lock fields match the same lock identity returned elsewhere for the same fixture. Purpose: guarantee consistent lock reporting across REST lock surfaces. Files (read/edit): `server/src/test/unit/ingest-roots-dedupe.test.ts`. Docs: https://jestjs.io/docs/getting-started.
7. [x] Add lock-parity test for `/tools/ingested-repos` against the unified lock resolver. Test type: Unit (Jest). Location: `server/src/test/unit/tools-ingested-repos.test.ts`. Description: assert tool response lock values match `/ingest/models` and `/ingest/roots` for the same underlying index state. Purpose: keep tool-layer lock reporting aligned with route-layer lock reporting. Files (read/edit): `server/src/test/unit/tools-ingested-repos.test.ts`. Docs: https://jestjs.io/docs/getting-started.
8. [x] Add lock-parity test for classic MCP lock-reporting output. Test type: Unit (Jest). Location: `server/src/test/unit/mcp-ingested-repositories.test.ts`. Description: assert classic MCP lock output matches the unified lock resolver for the same fixture state. Purpose: prevent MCP-specific lock drift after resolver unification. Files (read/edit): `server/src/test/unit/mcp-ingested-repositories.test.ts`. Docs: https://jestjs.io/docs/getting-started.
9. [x] Update markdown document `design.md` for Task 2 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document canonical lock-resolver ownership and cross-surface lock-read flow with Mermaid diagrams aligned to implemented resolver wiring. Purpose: make lock-source behavior explicit and consistent for future maintenance. Files (read/edit): `design.md`, plus Task 2 implementation files for verification (`server/src/ingest/chromaClient.ts`, `server/src/ingest/modelLock.ts`, `server/src/routes/ingestModels.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/routes/ingestStart.ts`, `server/src/lmstudio/toolService.ts`, `server/src/mcp/server.ts`). Docs: Context7 `/mermaid-js/mermaid` and https://www.jsonrpc.org/specification.
10. [x] Add canonical lock-source logs across all lock consumers. Files (read/edit): `server/src/ingest/chromaClient.ts`, `server/src/routes/ingestModels.ts`, `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/lmstudio/toolService.ts`, `server/src/mcp/server.ts`. Required log lines: `DEV-0000036:T2:lock_resolver_source_selected` (expected `source=canonical`) and `DEV-0000036:T2:lock_resolver_surface_parity` (expected identical `embeddingProvider`/`embeddingModel` for all surfaces in one fixture run). Purpose: prove lock-source unification is active everywhere.
11. [x] Update markdown document `projectStructure.md` for Task 2 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 2 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 2 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `None planned`. Removed files: `server/src/ingest/modelLock.ts` (only if deleted during resolver unification), otherwise explicitly record `None`.
12. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: exercise lock-reading surfaces from `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T2:lock_resolver_source_selected` (`source=canonical`) and `DEV-0000036:T2:lock_resolver_surface_parity` showing identical lock identity across surfaces. Expected outcome: parity log values match and browser debug console has zero errors.
9. [x] `npm run compose:down`

10. [x] `npm run test:unit --workspace server`
11. [x] Confirm `server/src/test/unit/tools-ingested-repos.test.ts` passes.
12. [x] Confirm `server/src/test/unit/ingest-roots-dedupe.test.ts` passes.

#### Implementation notes

- Canonical lock resolver unification completed: runtime lock reads now flow through `server/src/ingest/chromaClient.ts#getLockedModel`; placeholder path `server/src/ingest/modelLock.ts` removed.
- Lock-read surfaces rewired and parity-covered: `/ingest/models`, `/ingest/roots`, `/tools/ingested-repos`, `POST /ingest/start` conflict path, LM Studio vector search tooling, and classic MCP list routes now consume the same lock source while preserving current `lockedModelId` payload contract for Task 2.
- Added Task 2 lock observability logs across consumers and resolver (`DEV-0000036:T2:lock_resolver_source_selected`, `DEV-0000036:T2:lock_resolver_surface_parity`) and verified `source=canonical` plus identical `embeddingProvider`/`embeddingModel` values across surfaces in one fixture run.
- Added/updated lock-parity tests:
  - `server/src/test/unit/ingest-models.test.ts`
  - `server/src/test/unit/ingest-roots-dedupe.test.ts`
  - `server/src/test/unit/tools-ingested-repos.test.ts`
  - `server/src/test/unit/mcp-ingested-repositories.test.ts`
- Documentation updates completed for Task 2:
  - `design.md` now includes canonical lock-resolver ownership and cross-surface flow.
  - `projectStructure.md` now reflects removal of `server/src/ingest/modelLock.ts` and new Task 2 test files.
- Testing evidence:
  - `npm run compose:up` / manual Playwright-MCP check from `http://host.docker.internal:5001` / `npm run compose:down` completed.
  - Browser console error check returned zero errors.
  - Server `/logs` contained required Task 2 canonical lock log lines for `ingest/models`, `ingest/roots`, `tools/listIngestedRepositories`, and `mcp/ListIngestedRepositories`.
  - Focused tests passed: `tools-ingested-repos.test.ts`, `ingest-roots-dedupe.test.ts`.
  - `npm run test:unit --workspace server` still reports baseline unrelated failures already present before Task 2 (Codex default assertions and Codex model-id expectation drift in existing MCP/Codex tests).

---

### 3. Server: Environment loading parity for `.env` and `.env.local`

- Task Status: **__done__**
- Git Commits:
  - `ed9074f` - DEV-0000036 - Start Task 3 env loading parity
  - `320c151` - DEV-0000036 - Complete Task 3 env loading parity and verification
  - `39739e9` - DEV-0000036 - Mark Task 3 git commits in story plan

#### Overview

Implement deterministic local env loading (`server/.env` then `server/.env.local` override) to match expected docker behavior and ensure `OPENAI_EMBEDDING_KEY` startup behavior is predictable.

#### Documentation Locations

- dotenv documentation: https://github.com/motdotla/dotenv (use for multi-file loading order and override behavior).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating env-loading diagrams in `design.md`).
- Node.js environment variables: https://nodejs.org/api/environment_variables.html (use for runtime env parsing and process-level precedence rules).
- Docker Compose env variables: https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/ (use to match local env precedence behavior with compose semantics).
- OpenAI embeddings docs: https://developers.openai.com/api/docs/guides/embeddings/ (use for key-dependent capability handling and secret-safe operational context).
- Jest: Context7 `/jestjs/jest` (use for env-loading test structure and assertions in this task).
- Jest environment variables docs: https://jestjs.io/docs/environment-variables (use for deterministic env precedence tests).
- TypeScript handbook: https://www.typescriptlang.org/docs/ (use for typed config parser/refactor consistency).

#### Subtasks

1. [x] Implement deterministic env load order at startup. Files (read/edit): server bootstrap entry (`server/src/index.ts` or current startup file where `dotenv.config()` is called). Required behavior: load `server/.env` first, then load `server/.env.local` with override semantics, matching docker-compose env-file precedence used by this repo. Docs: https://github.com/motdotla/dotenv and https://nodejs.org/api/environment_variables.html.
2. [x] Handle absent `.env.local` without warning noise or startup failure. Files (read/edit): `server/src/index.ts`. Required behavior: missing local override file is valid and must not crash startup. Docs: https://github.com/motdotla/dotenv.
3. [x] Emit capability-safe startup logging for OpenAI embeddings. Files (read/edit): `server/src/index.ts`, `server/src/logger.ts`. Required behavior: log enabled/disabled capability only; never log `OPENAI_EMBEDDING_KEY` values or token-like strings. Docs: https://nodejs.org/api/environment_variables.html and https://developers.openai.com/api/docs/guides/embeddings/.
4. [x] Add env-precedence override test for local startup loading. Test type: Unit (Jest). Location: `server/src/test/unit/env-loading.test.ts`. Description: assert `.env.local` value overrides `.env` value for `OPENAI_EMBEDDING_KEY` (or equivalent test var) when both files are present. Purpose: lock deterministic startup precedence to match docker behavior. Files (read/edit): `server/src/test/unit/env-loading.test.ts`. Docs: https://jestjs.io/docs/environment-variables.
5. [x] Add env-fallback test when `.env.local` is absent. Test type: Unit (Jest). Location: `server/src/test/unit/env-loading.test.ts`. Description: assert startup succeeds without `.env.local` and still reads values from `.env`. Purpose: prevent regressions that break local startup in default setups. Files (read/edit): `server/src/test/unit/env-loading.test.ts`. Docs: https://jestjs.io/docs/environment-variables.
6. [x] Add key-redaction test for startup capability logging. Test type: Unit (Jest). Location: `server/src/test/unit/env-logging.test.ts`. Description: assert startup logs include OpenAI capability enabled/disabled state but never include raw key/token material. Purpose: enforce secret-safe logging guarantees for local startup parity changes. Files (read/edit): `server/src/test/unit/env-logging.test.ts`. Docs: https://jestjs.io/docs/environment-variables.
7. [x] Reuse established env parsing patterns instead of adding bespoke parser code. Files (read/edit): touched bootstrap/config files and references `server/src/config/chatDefaults.ts`, `server/src/config/codexEnvDefaults.ts`, `server/src/logger.ts`. Required behavior: keep parsing/validation style consistent with existing config modules. Docs: https://www.typescriptlang.org/docs/.
8. [x] Update markdown document `design.md` for Task 3 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document startup env precedence (`.env` then `.env.local`) and secret-safe capability logging flow with Mermaid diagrams that reflect implementation. Purpose: keep runtime configuration behavior documented and unambiguous. Files (read/edit): `design.md`, plus Task 3 implementation files for verification (server bootstrap/startup file where dotenv is loaded, `server/src/logger.ts`, `server/src/config/chatDefaults.ts`, `server/src/config/codexEnvDefaults.ts`). Docs: Context7 `/mermaid-js/mermaid`, https://github.com/motdotla/dotenv, and https://nodejs.org/api/environment_variables.html.
9. [x] Add startup env-loading logs for deterministic precedence and capability state. Files (read/edit): startup bootstrap file (`server/src/index.ts` or equivalent) and `server/src/logger.ts`. Required log lines: `DEV-0000036:T3:env_load_order_applied` (expected ordered files `[server/.env, server/.env.local]` and `overrideApplied=true|false`) and `DEV-0000036:T3:openai_embedding_capability_state` (expected `enabled=true|false` with no secret values). Purpose: make env precedence and key-gated capability observable without leaking secrets.
10. [x] Update markdown document `projectStructure.md` for Task 3 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 3 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 3 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `server/src/test/unit/env-loading.test.ts` and `server/src/test/unit/env-logging.test.ts` (if created by subtasks 4-6). Removed files: `None planned`.
11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check: start server and load ingest UI at `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T3:env_load_order_applied` with `.env -> .env.local` ordering and `DEV-0000036:T3:openai_embedding_capability_state` without secret material. Expected outcome: precedence/capability logs are present and browser debug console has zero errors.
9. [x] `npm run compose:down`

10. [x] `npm run test:unit --workspace server`
11. [x] Manual check: local startup loads with `.env.local` override and no key leakage in logs.

#### Implementation notes

- Subtask 1: Added `server/src/config/startupEnv.ts` with deterministic startup env loading (`.env` first, then `.env.local` override) and wired startup bootstrap to use it.
- Subtask 2: Implemented missing `.env.local` handling by checking file presence before including it in dotenv load paths; startup continues cleanly when absent.
- Subtask 3: Added startup capability-state logging flow that emits only `enabled=true|false` for OpenAI embeddings and does not include secret values.
- Subtasks 4-5: Added `server/src/test/unit/env-loading.test.ts` with override-order and missing-`.env.local` fallback coverage using temp env files.
- Subtask 6: Added `server/src/test/unit/env-logging.test.ts` to assert capability-state output excludes API key material.
- Subtask 7: Reused existing config parsing patterns by centralizing env bootstrap in `server/src/config/startupEnv.ts` and wiring through existing bootstrap/logger modules.
- Subtask 8: Updated `design.md` with Task 3 env precedence architecture notes and a startup sequence diagram for deterministic `.env` -> `.env.local` loading.
- Subtask 9: Added required startup logs `DEV-0000036:T3:env_load_order_applied` and `DEV-0000036:T3:openai_embedding_capability_state` to both structured logger and `/logs` append store.
- Subtask 10: Updated `projectStructure.md` entries for the new startup env module and Task 3 unit test files.
- Subtask 11: Ran workspace lint and format checks; formatting required a write pass for `env-loading.test.ts`, then all format checks passed.
- Testing 1: `npm run build --workspace server` passed after tightening `startupEnv.ts` dotenv `processEnv` typing to match Node process env usage.
- Testing 2: `npm run build --workspace client` passed (existing Vite large-chunk warning only).
- Testing 3: `npm run test --workspace server` executed to completion (`tests: 635`, `pass: 631`, `fail: 4`) with the same known baseline Codex/MCP expectation failures (`approvalPolicy`, `modelReasoningEffort`, and codex model-id assertions) observed in prior tasks.
- Testing 4: `npm run test --workspace client` passed (`90` suites / `333` tests).
- Testing 5: `npm run e2e` passed (`42 passed`), and the e2e harness completed automatic compose teardown (`e2e:down`) successfully.
- Testing 6: `npm run compose:build` completed successfully and produced fresh `codeinfo2-server` and `codeinfo2-client` images.
- Testing 7: `npm run compose:up` completed with healthy `codeinfo2-server-1` and started `codeinfo2-client-1` for manual verification.
- Testing 8: Manual Playwright-MCP check on `http://host.docker.internal:5001/ingest` confirmed UI load, zero browser console errors, and `/logs` entries for `DEV-0000036:T3:env_load_order_applied` (`orderedFiles=["server/.env","server/.env.local"]`) plus `DEV-0000036:T3:openai_embedding_capability_state` (`enabled=true`) without secret leakage.
- Testing 9: `npm run compose:down` completed successfully and removed all compose services/networks started for manual verification.
- Testing 10: `npm run test:unit --workspace server` completed with baseline known Codex expectation drift only (`tests: 635`, `pass: 631`, `fail: 4`; failures in existing `chat-codex-mcp` and MCP codex model-id expectation tests).
- Testing 11: Manual startup parity check executed against the built startup env module using temp `.env` + `.env.local` files; verified `.env.local` override (`overrideApplied=true`, effective value from local file) and confirmed serialized capability log payload contains no raw key value.

---

### 4. Server: Make break-step answer parsing robust while preserving strict JSON schema

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Improve break-step parsing so the flow engine can safely recover the required JSON answer from common wrapper output, while keeping schema validation strict and preserving deterministic failures when no valid payload exists.

#### Documentation Locations

- JSON (RFC 8259): https://www.rfc-editor.org/rfc/rfc8259 (use for JSON-object validity expectations).
- MDN `JSON.parse`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse (use for parser behavior and exception semantics).
- MDN regular expressions: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions (use for fenced-block extraction patterns).
- TypeScript handbook: https://www.typescriptlang.org/docs/ (use for typed parser helper signatures and narrowing).
- Jest: Context7 `/jestjs/jest` (use for parser unit-test structure and deterministic assertions).

#### Subtasks

1. [ ] Isolate break-answer parsing into a dedicated helper module or clearly separated helper region. Files (read/edit): `server/src/flows/service.ts` and/or `server/src/flows/breakAnswerParser.ts` (new). Constraint: do not introduce a second break-execution path; all break-step parsing must route through one helper.
2. [ ] Preserve strict parse as first strategy. Files (read/edit): break-answer parser helper in `server/src/flows/service.ts` (or extracted helper module). Required order: attempt direct `JSON.parse(content)` before any extraction fallback.
3. [ ] Add fenced JSON extraction as second strategy. Files (read/edit): break-answer parser helper. Required behavior: detect fenced code blocks that declare JSON (for example triple-backtick fences), parse candidate JSON object bodies, and continue deterministically if parsing fails.
4. [ ] Add balanced object candidate scanning as third strategy. Files (read/edit): break-answer parser helper. Required behavior: scan raw text for balanced JSON object candidates, parse candidates in appearance order, and stop at first schema-valid candidate.
5. [ ] Enforce schema gate exactly. Files (read/edit): break-answer parser helper. Required behavior: accept only objects matching `{ "answer": "yes" | "no" }`; reject missing/invalid answer values and reject extra properties.
6. [ ] Preserve terminal failure behavior when no valid object is found. Files (read/edit): `server/src/flows/service.ts` break-step post-process path. Required behavior: if all strategies fail, keep deterministic failure code `INVALID_BREAK_RESPONSE` with a user-readable message.
7. [ ] Keep final break content normalized. Files (read/edit): `server/src/flows/service.ts`. Required behavior: successful break parsing still emits canonical final content `{"answer":"yes"}` or `{"answer":"no"}` (no wrapper text).
8. [ ] Add parser-strategy observability logs. Files (read/edit): break parser/helper and flow service logging points. Required log lines: `DEV-0000036:T4:break_parse_strategy_attempted` (expected strategy name + candidate count) and `DEV-0000036:T4:break_parse_result` (expected `accepted=true|false` and normalized reason code).
9. [ ] Keep retry behavior decoupled from parser logic. Files (read/edit): parser helper and break-step post-process path. Constraint: parser helper must be pure and side-effect free; retries are handled by Task 5 logic only.
10. [ ] Add strict-body success unit test. Test type: Unit (Jest). Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: assert direct JSON body `{"answer":"yes"}` is accepted by first strategy. Purpose: lock current strict behavior as highest-precedence parse route.
11. [ ] Add fenced JSON success unit test. Test type: Unit (Jest). Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: assert fenced JSON block containing `{"answer":"no"}` is accepted when strict parse fails. Purpose: cover fallback strategy 2.
12. [ ] Add balanced-object success unit test. Test type: Unit (Jest). Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: assert mixed text with embedded balanced JSON object is accepted when strategies 1 and 2 fail. Purpose: cover fallback strategy 3.
13. [ ] Add precedence-order unit test for strategy execution. Test type: Unit (Jest). Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: assert when both strict body and fallback candidates exist, strict body wins. Purpose: enforce deterministic parse order.
14. [ ] Add schema-rejection unit test for extra keys. Test type: Unit (Jest). Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: assert objects like `{"answer":"yes","extra":true}` are rejected. Purpose: enforce exact schema gating.
15. [ ] Add schema-rejection unit test for invalid answer values. Test type: Unit (Jest). Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: assert `{"answer":"maybe"}` is rejected with deterministic error message. Purpose: preserve existing answer-domain constraints.
16. [ ] Add terminal-failure unit test when no valid JSON candidate exists. Test type: Unit (Jest). Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: assert parser returns invalid result and expected message for non-JSON content. Purpose: maintain deterministic failure output.
17. [ ] Update break-flow integration test for wrapper-output recovery. Test type: Integration (Jest + Supertest). Location: `server/src/test/integration/flows.run.loop.test.ts`. Description: add scenario where break reply includes wrapper text + fenced/object JSON and verify run completes using parsed answer. Purpose: prove end-to-end fallback behavior.
18. [ ] Add break-flow integration test for unrecoverable output failure. Test type: Integration (Jest + Supertest). Location: `server/src/test/integration/flows.run.loop.test.ts`. Description: assert break run still fails with `INVALID_BREAK_RESPONSE` when no candidate matches schema. Purpose: prove deterministic hard-failure behavior is preserved.
19. [ ] Update markdown document `design.md` for Task 4 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document parse strategy order (strict -> fenced -> balanced), schema gate rules, and break-step failure handling with Mermaid diagrams matching implementation. Purpose: keep parsing behavior explicit for junior contributors and reviewers.
20. [ ] Add/update markdown document `projectStructure.md` for Task 4 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add entries for parser helper/test files created or renamed by this task. Purpose: keep file-map documentation in sync with implementation changes.
21. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (for example `npm run lint:fix` / `npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run test:unit --workspace server`
6. [ ] `npm run test --workspace server -- flows.break-parser`
7. [ ] `npm run test --workspace server -- flows.run.loop`
8. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
9. [ ] `npm run compose:build`
10. [ ] `npm run compose:up`
11. [ ] Manual check: run a break flow with wrapper text around JSON answer and verify `/logs` includes `DEV-0000036:T4:break_parse_strategy_attempted` plus `DEV-0000036:T4:break_parse_result` with accepted normalized answer and zero browser console errors.
12. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 5. Server: Add configurable retry budget for failed command and flow steps

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Increase resilience by retrying failed command and flow execution steps with a single shared retry budget defaulting to 5 total attempts, controlled by a new environment variable `FLOW_AND_COMMAND_RETRIES`.

#### Documentation Locations

- Node.js environment variables: https://nodejs.org/api/environment_variables.html (use for runtime env parsing and defaulting rules).
- TypeScript handbook: https://www.typescriptlang.org/docs/ (use for typed retry-config helper and call-site integration).
- Existing retry utility: `server/src/agents/retry.ts` (reuse this implementation; do not add a parallel retry framework).
- Jest: Context7 `/jestjs/jest` (use for retry-budget unit/integration test patterns).
- Express error handling: https://expressjs.com/en/guide/error-handling.html (use for preserving deterministic failure/stopped semantics during retries).

#### Subtasks

1. [ ] Add a shared retry-budget config helper. Files (read/edit): `server/src/config/*` (new helper file, for example `flowAndCommandRetries.ts`) plus consuming modules. Required behavior: parse `FLOW_AND_COMMAND_RETRIES` as positive integer, default to `5` when unset/invalid.
2. [ ] Define retry-attempt semantics explicitly in code comments and docs. Files (read/edit): new config helper + consuming call sites. Required behavior: `FLOW_AND_COMMAND_RETRIES` represents total attempts (initial attempt included), not extra retries.
3. [ ] Wire command-runner retries to shared config. Files (read/edit): `server/src/agents/commandsRunner.ts`. Required behavior: replace hardcoded `MAX_ATTEMPTS` with parsed shared retry budget while preserving existing delay strategy.
4. [ ] Wire flow-step retries to shared config. Files (read/edit): `server/src/flows/service.ts` and `server/src/agents/retry.ts` consumers. Required behavior: failed LLM/break/command flow instruction executions retry through existing `runWithRetry` utility up to configured attempt budget.
5. [ ] Preserve non-retryable stopped/aborted semantics. Files (read/edit): flow and command retry call sites. Required behavior: `AbortError`, explicit stop/cancel statuses, and user-initiated abort paths must not be retried.
6. [ ] Retry failed break-step execution attempts while preserving schema enforcement. Files (read/edit): `server/src/flows/service.ts`. Required behavior: when a break attempt fails (including `INVALID_BREAK_RESPONSE`), retry the step until budget exhausted; final failure must keep deterministic error payload.
7. [ ] Keep lock and inflight behavior stable across retries. Files (read/edit): `server/src/flows/service.ts`, `server/src/chat/inflightRegistry.ts` interaction points, `server/src/agents/commandsRunner.ts`. Required behavior: retries must not leak locks/inflight handles or duplicate final persistence in terminal paths.
8. [ ] Add retry observability logs for command and flow steps. Files (read/edit): `server/src/agents/commandsRunner.ts`, `server/src/flows/service.ts`. Required log lines: `DEV-0000036:T5:step_retry_attempt` (expected `surface=command|flow`, `attempt`, `maxAttempts`, `reason`) and `DEV-0000036:T5:step_retry_exhausted` (expected same metadata with terminal status).
9. [ ] Ensure local/dockered startup env loading includes `FLOW_AND_COMMAND_RETRIES` in capability-safe startup diagnostics. Files (read/edit): startup/env logging modules touched in Task 3. Required behavior: log configured retry budget value only, no secret data.
10. [ ] Add retry-config default unit test. Test type: Unit (Jest). Location: `server/src/test/unit/flow-command-retries-config.test.ts`. Description: assert helper returns `5` when `FLOW_AND_COMMAND_RETRIES` is unset. Purpose: lock expected default behavior.
11. [ ] Add retry-config invalid-value fallback unit test. Test type: Unit (Jest). Location: `server/src/test/unit/flow-command-retries-config.test.ts`. Description: assert invalid values (`0`, negative, non-numeric) fallback to `5`. Purpose: enforce deterministic parsing.
12. [ ] Add retry-config override unit test. Test type: Unit (Jest). Location: `server/src/test/unit/flow-command-retries-config.test.ts`. Description: assert valid env override (for example `2`) is applied exactly. Purpose: verify override capability.
13. [ ] Update command-runner retry unit test for new default budget. Test type: Unit (Jest). Location: `server/src/test/unit/agent-commands-runner-retry.test.ts`. Description: assert command runner honors shared default (`5`) when env is unset. Purpose: prevent regressions to old hardcoded attempt count.
14. [ ] Add command-runner env-override retry unit test. Test type: Unit (Jest). Location: `server/src/test/unit/agent-commands-runner-retry.test.ts`. Description: assert command runner uses overridden budget from `FLOW_AND_COMMAND_RETRIES`. Purpose: verify runtime configurability.
15. [ ] Add flow-step retry integration test for transient failures that recover. Test type: Integration (Jest + Supertest). Location: `server/src/test/integration/flows.run.loop.test.ts` (or dedicated new flow retry integration file). Description: simulate failed attempts before success and assert flow completes within configured budget. Purpose: prove flow retry behavior works end to end.
16. [ ] Add flow-step retry integration test for exhausted budget. Test type: Integration (Jest + Supertest). Location: `server/src/test/integration/flows.run.loop.test.ts` (or dedicated new flow retry integration file). Description: simulate persistent failure and assert final status is failed only after configured attempts are exhausted. Purpose: verify deterministic terminal behavior.
17. [ ] Add flow-step integration test to ensure stopped/aborted runs are not retried. Test type: Integration (Jest + Supertest). Location: `server/src/test/integration/flows.run.loop.test.ts` (or dedicated new flow retry integration file). Description: abort mid-run and assert no additional retry attempts occur. Purpose: preserve user stop semantics.
18. [ ] Update markdown document `design.md` for Task 5 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document shared retry-budget config, flow/command retry sequence, and non-retryable abort/stopped rules with Mermaid diagrams matching implementation. Purpose: make retry behavior and boundaries explicit.
19. [ ] Add/update markdown document `projectStructure.md` for Task 5 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add entries for retry-config and retry-test files created or renamed by this task. Purpose: keep file-map documentation current.
20. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (for example `npm run lint:fix` / `npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run test:unit --workspace server`
6. [ ] `npm run test --workspace server -- agent-commands-runner-retry`
7. [ ] `npm run test --workspace server -- flow-command-retries-config`
8. [ ] `npm run test --workspace server -- flows.run.loop`
9. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
10. [ ] `npm run compose:build`
11. [ ] `npm run compose:up`
12. [ ] Manual check: run one command flow and one break/llm flow with induced transient failures; verify `/logs` includes `DEV-0000036:T5:step_retry_attempt` and `DEV-0000036:T5:step_retry_exhausted` with correct attempt counts and zero browser console errors.
13. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.

---

### 6. Server: Add OpenAI embedding provider adapter with retries, limits, and taxonomy mapping

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Implement OpenAI embedding execution behind the shared provider interface, including bounded retry policy, request guardrails, and normalized error taxonomy. No route contract changes in this task.

#### Documentation Locations

- OpenAI embeddings guide: https://developers.openai.com/api/docs/guides/embeddings/ (use for request limits, model behavior, and payload expectations).
- OpenAI models list API: https://developers.openai.com/api/docs/api-reference/models/list (use for allowlist-intersection and model availability validation behavior).
- OpenAI Node SDK: Context7 `/openai/openai-node/v6_1_0` (use for timeout, retry, error-class behavior, and per-request options).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating provider/retry/error-flow diagrams in `design.md`).
- DeepWiki OpenAI Node: https://deepwiki.com/openai/openai-node (use for SDK structure cross-reference while implementing adapters/mappers).
- Chroma docs: Context7 `/chroma-core/chroma` (use for dimension compatibility requirements before vector writes/queries).
- MDN `Retry-After` header: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After (use for wait-hint precedence and fallback parsing semantics).
- Jest: Context7 `/jestjs/jest` (use for retry/guardrail/error taxonomy unit test coverage patterns).

#### Subtasks

1. [ ] Add official OpenAI SDK dependency. Files (read/edit): `server/package.json`, `package-lock.json`. Constraint: use `openai` for embeddings/models calls; do not route these calls through `@openai/codex-sdk`. Docs: https://developers.openai.com/api/docs/guides/embeddings/ and Context7 `/openai/openai-node/v6_1_0`.
2. [ ] Create OpenAI provider module with explicit provider contract. Files (read/edit): `server/src/ingest/providers/*` (new module + types). Constraint: no parallel provider framework; extend existing provider abstraction from Task 1. Docs: Context7 `/openai/openai-node/v6_1_0`.
3. [ ] Wire OpenAI provider into ingest-time embedding path. Files (read/edit): `server/src/ingest/ingestJob.ts` and provider module files. Constraint: keep existing ingest lifecycle/state handling unchanged except provider selection and error mapping. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
4. [ ] Wire OpenAI provider into query-time embedding path. Files (read/edit): `server/src/ingest/chromaClient.ts`, `server/src/lmstudio/toolService.ts`, provider module files under `server/src/ingest/providers/`. Constraint: do not add a second vector-search execution path. Docs: Context7 `/chroma-core/chroma`.
5. [ ] Add model-specific token-limit resolution utility for OpenAI models. Files (read/edit): provider module utility file(s) under `server/src/ingest/providers/`. Constraint: no single global token constant for all models. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
6. [ ] Enforce ingest-time OpenAI request guardrails. Files (read/edit): `server/src/ingest/ingestJob.ts`, provider module files. Constraint: block invalid batches before upstream call (`<=2048` inputs, per-input limit, `<=300000` total tokens). Docs: https://developers.openai.com/api/docs/guides/embeddings/.
7. [ ] Enforce query-time OpenAI request guardrails. Files (read/edit): `server/src/ingest/chromaClient.ts`, `server/src/lmstudio/toolService.ts`, provider module files. Constraint: same limits as ingest path. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
8. [ ] Reuse existing retry utility without refactor. Files (read/edit): `server/src/agents/retry.ts`, provider integration call sites. Constraint: no new retry framework in this story. Docs: Context7 `/openai/openai-node/v6_1_0`.
9. [ ] Implement wait-hint precedence handling. Files (read/edit): provider module error/retry handling functions. Constraint: `retry-after-ms` then `retry-after`, else bounded exponential fallback. Docs: Context7 `/openai/openai-node/v6_1_0`.
10. [ ] Implement wait-hint invalid-value fallback rules. Files (read/edit): provider module retry parsing logic. Constraint: invalid/negative/unparseable hints must not throw; fallback to bounded delay. Docs: Context7 `/openai/openai-node/v6_1_0`.
11. [ ] Enforce timeout and retry ownership. Files (read/edit): provider client creation and call options in `server/src/ingest/providers/*`. Constraint: timeout `30000ms` per attempt and OpenAI SDK `maxRetries=0`. Docs: Context7 `/openai/openai-node/v6_1_0`.
12. [ ] Map OpenAI errors to story taxonomy. Files (read/edit): provider error mapper(s) and shared error type(s) used by ingest/vector-search paths. Constraint: return deterministic `OPENAI_*` codes only. Docs: DeepWiki https://deepwiki.com/openai/openai-node.
13. [ ] Add explicit quota/input-too-large mappings. Files (read/edit): provider error mapper(s). Constraint: quota/credit -> `OPENAI_QUOTA_EXCEEDED`; token/input size (including `context_length_exceeded`) -> `OPENAI_INPUT_TOO_LARGE`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
14. [ ] Validate embedding response payload shape before writes. Files (read/edit): provider response parser and write call sites in `server/src/ingest/ingestJob.ts`/`server/src/ingest/chromaClient.ts`. Constraint: reject empty/non-numeric vectors deterministically. Docs: Context7 `/openai/openai-node/v6_1_0`.
15. [ ] Normalize retry-budget exhausted failures. Files (read/edit): provider retry wrapper and error mapper. Constraint: terminal error must include normalized metadata (`retryable`, `upstreamStatus`, `retryAfterMs?`) and never leak raw SDK error objects. Docs: Context7 `/openai/openai-node/v6_1_0`.
16. [ ] Enforce secret-safe error/log metadata. Files (read/edit): provider boundary logging/error serialization, plus any route/tool layer passthroughs touched. Constraint: never log/expose API key/header/token material. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
17. [ ] Add retry-defaults test for bounded exponential policy values. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-retry.test.ts`. Description: assert `maxRetries=3`, `baseDelayMs=500`, `maxDelayMs=8000`, and jitter factor range `[0.75, 1.0]` are applied by the server retry path. Purpose: prevent accidental retry-policy drift. Files (read/edit): `server/src/test/unit/openai-provider-retry.test.ts`. Docs: https://jestjs.io/docs/getting-started.
18. [ ] Add wait-hint precedence test for `retry-after-ms` over `retry-after`. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-retry.test.ts`. Description: assert when both headers are present, delay selection uses `retry-after-ms` first. Purpose: enforce deterministic wait-hint precedence. Files (read/edit): `server/src/test/unit/openai-provider-retry.test.ts`. Docs: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After.
19. [ ] Add wait-hint fallback test for invalid/negative/unparseable header values. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-retry.test.ts`. Description: assert invalid wait hints do not throw and fallback to bounded exponential delay. Purpose: guarantee robust retry timing under malformed upstream headers. Files (read/edit): `server/src/test/unit/openai-provider-retry.test.ts`. Docs: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After.
20. [ ] Add timeout/retry-ownership test for OpenAI SDK call options. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider.test.ts`. Description: assert each embeddings call uses timeout `30000ms` and SDK `maxRetries=0`. Purpose: enforce single-layer retry ownership by server retry utility. Files (read/edit): `server/src/test/unit/openai-provider.test.ts`. Docs: Context7 `/openai/openai-node/v6_1_0`.
21. [ ] Add taxonomy mapping test for auth/permission/model/bad-request/unprocessable failures. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-errors.test.ts`. Description: assert `401/403/404/400/422` conditions map to `OPENAI_AUTH_FAILED`, `OPENAI_PERMISSION_DENIED`, `OPENAI_MODEL_UNAVAILABLE`, `OPENAI_BAD_REQUEST`, and `OPENAI_UNPROCESSABLE`. Purpose: keep non-retryable taxonomy mapping deterministic. Files (read/edit): `server/src/test/unit/openai-provider-errors.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
22. [ ] Add taxonomy mapping test for input-too-large failures. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-errors.test.ts`. Description: assert token/size-limit failures including `context_length_exceeded` map to `OPENAI_INPUT_TOO_LARGE`. Purpose: ensure size-limit failures are classified separately from generic bad requests. Files (read/edit): `server/src/test/unit/openai-provider-errors.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
23. [ ] Add taxonomy mapping test for rate-limit/quota/timeout/connection/unavailable failures. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-errors.test.ts`. Description: assert retryable and quota classes map to `OPENAI_RATE_LIMITED`, `OPENAI_QUOTA_EXCEEDED`, `OPENAI_TIMEOUT`, `OPENAI_CONNECTION_FAILED`, and `OPENAI_UNAVAILABLE` with expected metadata fields. Purpose: keep retry behavior and user messaging consistent. Files (read/edit): `server/src/test/unit/openai-provider-errors.test.ts`. Docs: Context7 `/openai/openai-node/v6_1_0`.
24. [ ] Add retryability-classification matrix assertions for all normalized `OPENAI_*` codes. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-errors.test.ts`. Description: assert every normalized code has expected `retryable` value and required metadata shape (`provider`, `message`, optional `upstreamStatus`, `retryAfterMs`). Purpose: make taxonomy coverage complete and auditable. Files (read/edit): `server/src/test/unit/openai-provider-errors.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
25. [ ] Add embedding response-shape validation tests. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider.test.ts`. Description: assert empty vectors and non-numeric vectors are rejected with normalized deterministic errors before writes/queries. Purpose: prevent bad upstream payloads from corrupting vector operations. Files (read/edit): `server/src/test/unit/openai-provider.test.ts`. Docs: Context7 `/openai/openai-node/v6_1_0`.
26. [ ] Add guardrail boundary test for input array count limits. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-guardrails.test.ts`. Description: assert `2048` inputs pass and `2049` inputs are rejected before upstream request. Purpose: enforce OpenAI request-array hard limit. Files (read/edit): `server/src/test/unit/openai-provider-guardrails.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
27. [ ] Add guardrail boundary test for total token limits per request. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-guardrails.test.ts`. Description: assert `300000` total tokens pass and `300001` tokens are rejected before upstream request. Purpose: enforce total-token hard limit for each OpenAI embeddings call. Files (read/edit): `server/src/test/unit/openai-provider-guardrails.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
28. [ ] Add guardrail boundary test for per-input token max by model. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-guardrails.test.ts`. Description: assert per-model boundaries for `max-1`, `max`, and `max+1` tokens per input. Purpose: enforce model-specific token-limit resolution utility behavior. Files (read/edit): `server/src/test/unit/openai-provider-guardrails.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
29. [ ] Add secret-safety redaction tests for provider error/log metadata. Test type: Unit (Jest). Location: `server/src/test/unit/openai-provider-errors.test.ts`. Description: assert emitted error/log metadata never includes API key/header/token substrings. Purpose: protect secrets across all adapter failure paths. Files (read/edit): `server/src/test/unit/openai-provider-errors.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
30. [ ] Update markdown document `design.md` for Task 6 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document OpenAI adapter flow, guardrail checks, retry/wait-hint resolution order, and normalized error taxonomy mapping with Mermaid diagrams matching implementation. Purpose: keep provider architecture behavior explicit and traceable. Files (read/edit): `design.md`, plus Task 6 implementation files for verification (`server/src/ingest/providers/*`, `server/src/ingest/ingestJob.ts`, `server/src/ingest/chromaClient.ts`, `server/src/lmstudio/toolService.ts`, `server/src/agents/retry.ts`). Docs: Context7 `/mermaid-js/mermaid`, Context7 `/openai/openai-node/v6_1_0`, and https://developers.openai.com/api/docs/guides/embeddings/.
31. [ ] Add OpenAI adapter execution logs for retries, guardrails, and taxonomy mapping. Files (read/edit): OpenAI provider files under `server/src/ingest/providers/`, `server/src/ingest/ingestJob.ts`, and `server/src/ingest/chromaClient.ts`. Required log lines: `DEV-0000036:T6:openai_embedding_attempt` (expected `attempt`, `model`, `inputCount`, `tokenEstimate`) and `DEV-0000036:T6:openai_embedding_result_mapped` (expected `status=success|error`, canonical `code`, `retryable`, optional `waitMs`). Purpose: confirm adapter behavior and mapping decisions during live runs.
32. [ ] Update markdown document `projectStructure.md` for Task 6 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 6 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 6 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `server/src/ingest/providers/openai*.ts` (new adapter/helper modules from subtasks 2 and 5-16), `server/src/test/unit/openai-provider-retry.test.ts`, `server/src/test/unit/openai-provider.test.ts`, `server/src/test/unit/openai-provider-errors.test.ts`, and `server/src/test/unit/openai-provider-guardrails.test.ts` (if created by subtasks 17-29). Removed files: `None planned`.
33. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: run OpenAI-backed ingest/vector-search from `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T6:openai_embedding_attempt` (attempt/model/input metadata) and `DEV-0000036:T6:openai_embedding_result_mapped` (canonical code/retryable mapping). Expected outcome: attempt/result logs align with observed behavior and browser debug console has zero errors.
9. [ ] `npm run compose:down`

10. [ ] `npm run test:unit --workspace server`
11. [ ] Confirm `npm ls openai --workspace server` resolves exactly one installed `openai` package and no ingestion code imports `@openai/codex-sdk` for embeddings/model-list calls.
12. [ ] Confirm taxonomy/guardrail tests pass in provider adapter test suite.
13. [ ] Confirm retry-exhaustion normalization tests pass (terminal error metadata, no raw SDK leak-through).
14. [ ] Confirm wait-hint precedence tests (header-order and fallback) plus edge-case tests (invalid/negative/unparseable hints) pass in provider retry test suite.
15. [ ] Confirm OpenAI taxonomy tests cover upstream input-too-large mapping (`OPENAI_INPUT_TOO_LARGE`) and quota mapping (`OPENAI_QUOTA_EXCEEDED`).
16. [ ] Confirm OpenAI adapter tests prove API key/token material is not present in emitted error/log metadata.
17. [ ] Confirm taxonomy matrix tests cover every planned `OPENAI_*` category with expected `retryable` classification and metadata.
18. [ ] Confirm boundary-value guardrail tests pass for inputs/token limits at and beyond hard limits (`2048/2049`, `300000/300001`, per-input max boundary cases).

#### Implementation notes

- Notes added during implementation.

---

### 7. Server: Provider-aware lock identity and embedding execution in ingest/reembed/vector-search internals

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Extend lock identity from model-only to provider+model+dimensions internally, with backward compatibility inference for legacy metadata. This task updates core behavior, not external message contracts yet.

#### Documentation Locations

- Chroma docs: Context7 `/chroma-core/chroma` (use for lock-dimension consistency and pre-query mismatch handling requirements).
- DeepWiki Chroma: https://deepwiki.com/chroma-core/chroma (use for additional collection behavior references during lock metadata updates).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating lock/dimension architecture diagrams in `design.md`).
- OpenAPI 3.0.3: https://spec.openapis.org/oas/v3.0.3.html (use for canonical lock field naming consistency with REST contracts).
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification (use for classic MCP vector-search parity behavior).
- Express error handling: https://expressjs.com/en/guide/error-handling.html (use for deterministic `BUSY`/validation error responses).
- TypeScript handbook: https://www.typescriptlang.org/docs/ (use for canonical lock type definitions and compatibility mappings).
- Jest: Context7 `/jestjs/jest` (use for concurrency/lifecycle and lock-compat regression tests).

#### Subtasks

1. [ ] Add canonical lock type in existing lock helpers. Files (read/edit): `server/src/ingest/chromaClient.ts`. Constraint: extend existing lock helper surface (`getLockedModel`/`setLockedModel`/`clearLockedModel`) instead of adding a second lock store. Docs: Context7 `/chroma-core/chroma`.
2. [ ] Implement dual-read + canonical-write lock compatibility. Files (read/edit): `server/src/ingest/chromaClient.ts`, `server/src/ingest/ingestJob.ts`. Constraint: lock-read order must be canonical fields (`embeddingProvider`, `embeddingModel`, `embeddingDimensions`) first, then legacy aliases (`lockedModelId`, root `model`); when provider is missing in legacy metadata infer `lmstudio`; all new lock writes must persist canonical fields. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
3. [ ] Update re-embed metadata resolution order. Files (read/edit): `server/src/ingest/ingestJob.ts` (`reembed(...)` path). Constraint: resolve provider/model in this exact order: canonical lock fields -> legacy root `model`; reject requests that would switch provider/model away from the lock. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
4. [ ] Persist lock dimensions from first successful embedding write. Files (read/edit): `server/src/ingest/ingestJob.ts`, `server/src/ingest/chromaClient.ts`. Constraint: persist `embeddingDimensions` for later validation/diagnostics. Docs: Context7 `/chroma-core/chroma`.
5. [ ] Reject partial canonical lock metadata deterministically. Files (read/edit): `server/src/ingest/chromaClient.ts`, `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`. Constraint: no silent inference when only part of canonical lock metadata is present; return a deterministic validation error instead. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
6. [ ] Enforce locked provider/model in re-embed execution. Files (read/edit): `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`. Constraint: re-embed must always use stored lock provider/model and must not accept request-driven provider/model switching. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
7. [ ] Enforce locked provider/model in REST vector-search path. Files (read/edit): `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsVectorSearch.ts`. Constraint: query embeddings must always use the locked provider/model for that repository. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.jsonrpc.org/specification.
8. [ ] Enforce locked provider/model in classic MCP vector-search path. Files (read/edit): `server/src/mcp/server.ts`, `server/src/lmstudio/toolService.ts`. Constraint: behavior must match REST vector-search lock enforcement exactly. Docs: https://www.jsonrpc.org/specification and https://spec.openapis.org/oas/v3.0.3.html.
9. [ ] Add pre-query dimension mismatch guard. Files (read/edit): `server/src/lmstudio/toolService.ts` and any shared embedding/query helper touched. Constraint: return normalized `EMBEDDING_DIMENSION_MISMATCH` before Chroma query. Docs: Context7 `/chroma-core/chroma`.
10. [ ] Keep existing lock ownership gate as authoritative. Files (read/edit): `server/src/ingest/lock.ts`, `server/src/ingest/ingestJob.ts`, `server/src/routes/ingestStart.ts`. Constraint: preserve deterministic `BUSY` semantics for concurrent start/re-embed/remove requests and do not introduce a second lock gate. Docs: https://expressjs.com/en/guide/error-handling.html and https://spec.openapis.org/oas/v3.0.3.html.
11. [ ] Release stale lock ownership after terminal/cancel. Files (read/edit): `server/src/ingest/ingestJob.ts`. Constraint: ensure lock ownership is released on terminal and cancel paths so later mutations do not fail with false `BUSY`. Docs: https://expressjs.com/en/guide/error-handling.html and https://spec.openapis.org/oas/v3.0.3.html.
12. [ ] Add re-embed eligibility validation for bad states. Files (read/edit): `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`. Constraint: reject invalid root states (`cancelled`, `error`, missing required metadata) before starting a run. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
13. [ ] Add legacy-lock inference test for missing provider metadata. Test type: Unit (Jest). Location: `server/src/test/unit/chroma-lock.test.ts`. Description: assert legacy metadata (`lockedModelId`/root `model`) resolves to `embeddingProvider=lmstudio` when provider is absent. Purpose: preserve backward compatibility for pre-story indexes. Files (read/edit): `server/src/test/unit/chroma-lock.test.ts`. Docs: https://jestjs.io/docs/getting-started.
14. [ ] Add canonical-write lock persistence test for provider/model/dimensions. Test type: Unit (Jest). Location: `server/src/test/unit/chroma-lock.test.ts`. Description: assert successful writes persist `embeddingProvider`, `embeddingModel`, and `embeddingDimensions` in canonical fields. Purpose: verify canonical lock storage is written deterministically. Files (read/edit): `server/src/test/unit/chroma-lock.test.ts`. Docs: https://jestjs.io/docs/getting-started.
15. [ ] Add partial-canonical lock rejection test. Test type: Unit (Jest). Location: `server/src/test/unit/chroma-lock.test.ts`. Description: assert partially populated canonical lock metadata is rejected with deterministic error instead of silently inferred. Purpose: prevent corrupted lock states from producing undefined behavior. Files (read/edit): `server/src/test/unit/chroma-lock.test.ts`. Docs: https://jestjs.io/docs/getting-started.
16. [ ] Add re-embed lock-enforcement test for provider/model immutability. Test type: Integration (Jest). Location: `server/src/test/integration/ingest-reembed.test.ts`. Description: assert re-embed execution always uses stored lock provider/model and cannot be overridden by request input. Purpose: enforce provider/model locking in mutation workflows. Files (read/edit): `server/src/test/integration/ingest-reembed.test.ts`. Docs: https://jestjs.io/docs/getting-started.
17. [ ] Add REST vector-search lock-enforcement test. Test type: Integration (Jest). Location: `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`. Description: assert REST vector-search embeddings use locked provider/model for an already-ingested repository. Purpose: keep query-time embedding parity with ingest lock. Files (read/edit): `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`. Docs: https://jestjs.io/docs/getting-started.
18. [ ] Add classic MCP vector-search lock-enforcement test. Test type: Integration (Jest). Location: `server/src/test/integration/mcp-vector-search.test.ts`. Description: assert classic MCP `VectorSearch` uses identical locked provider/model behavior as REST. Purpose: maintain cross-surface lock enforcement parity. Files (read/edit): `server/src/test/integration/mcp-vector-search.test.ts`. Docs: https://jestjs.io/docs/getting-started.
19. [ ] Add pre-query dimension-mismatch guard test. Test type: Unit (Jest). Location: `server/src/test/unit/tools-vector-search.test.ts`. Description: assert mismatched embedding dimension is rejected with `EMBEDDING_DIMENSION_MISMATCH` before Chroma query execution. Purpose: prevent raw Chroma dimension exceptions from leaking. Files (read/edit): `server/src/test/unit/tools-vector-search.test.ts`. Docs: https://jestjs.io/docs/getting-started.
20. [ ] Add lock-ownership concurrency lifecycle test for deterministic `BUSY` handling. Test type: Integration (Jest). Location: `server/src/test/integration/ingest-lock-lifecycle.test.ts`. Description: assert concurrent start/reembed/remove operations return deterministic `BUSY` behavior and release lock ownership after terminal/cancel paths. Purpose: prevent deadlocks and false-busy regressions. Files (read/edit): `server/src/test/integration/ingest-lock-lifecycle.test.ts`. Docs: https://jestjs.io/docs/getting-started.
21. [ ] Add lock-clear idempotence test for empty-collection cleanup edge cases. Test type: Integration (Jest). Location: `server/src/test/integration/ingest-lock-lifecycle.test.ts`. Description: assert stale lock metadata clears when collection is empty and never clears a newly established lock from a newer run. Purpose: protect lock consistency during cleanup race edges. Files (read/edit): `server/src/test/integration/ingest-lock-lifecycle.test.ts`. Docs: Context7 `/chroma-core/chroma` and https://jestjs.io/docs/getting-started.
22. [ ] Update markdown document `design.md` for Task 7 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document canonical lock identity fields, legacy-compat resolution order, and query-time dimension guard flow with Mermaid diagrams aligned to implementation. Purpose: keep locking architecture clear for maintenance and regression work. Files (read/edit): `design.md`, plus Task 7 implementation files for verification (`server/src/ingest/chromaClient.ts`, `server/src/ingest/ingestJob.ts`, `server/src/ingest/reingestService.ts`, `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsVectorSearch.ts`, `server/src/mcp/server.ts`). Docs: Context7 `/mermaid-js/mermaid`, Context7 `/chroma-core/chroma`, and https://www.jsonrpc.org/specification.
23. [ ] Add lock lifecycle logs for provider-aware identity writes/clears. Files (read/edit): `server/src/ingest/chromaClient.ts`, `server/src/ingest/ingestJob.ts`, `server/src/lmstudio/toolService.ts`, and lock utility modules touched by this task. Required log lines: `DEV-0000036:T7:embedding_lock_written` (expected `embeddingProvider`, `embeddingModel`, `embeddingDimensions`) and `DEV-0000036:T7:embedding_lock_cleared` (expected clear reason such as `completed|cleanup|remove` and the cleared lock id). Purpose: verify lock lifecycle transitions are deterministic and provider-aware.
24. [ ] Update markdown document `projectStructure.md` for Task 7 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 7 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 7 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `server/src/test/unit/chroma-lock.test.ts` and `server/src/test/integration/ingest-lock-lifecycle.test.ts` (if created by subtasks 13-21). Removed files: `None planned`.
25. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: run ingest start/reembed/remove flows from `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T7:embedding_lock_written` with provider/model/dimensions and `DEV-0000036:T7:embedding_lock_cleared` with correct lifecycle reason. Expected outcome: write/clear lifecycle logs appear in correct sequence and browser debug console has zero errors.
9. [ ] `npm run compose:down`

10. [ ] `npm run test:unit --workspace server`
11. [ ] `npm run test:integration --workspace server`
12. [ ] Confirm `server/src/test/integration/chat-vectorsearch-locked-model.test.ts` passes.
13. [ ] Confirm classic MCP vector-search parity and ingest lock-lifecycle tests pass.
14. [ ] Confirm invalid partial-canonical lock metadata and lock lifecycle cleanup tests pass.
15. [ ] Confirm concurrency tests pass with deterministic `BUSY` outcomes for concurrent start/reembed/remove operations.
16. [ ] Confirm lock-clear idempotence tests pass for empty-collection cleanup without clearing a newer lock.

#### Implementation notes

- Notes added during implementation.

---

### 8. Server Messages: `/ingest/models` provider-aware response contract and warning states

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Implement the agreed `/ingest/models` contract (`models`, `lock`, `openai`, `lmstudio`, compatibility alias `lockedModelId`) including deterministic warning states. This task is intentionally server-message focused.

#### Documentation Locations

- OpenAPI 3.0.3: https://spec.openapis.org/oas/v3.0.3.html (use for `/ingest/models` envelope schema and required/optional field semantics).
- OpenAI models list API: https://developers.openai.com/api/docs/api-reference/models/list (use for allowlist intersection and provider availability states).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating `/ingest/models` status-flow diagrams in `design.md`).
- Express error handling: https://expressjs.com/en/guide/error-handling.html (use for deterministic `200` warning-envelope behavior instead of route-level hard failures).
- Node.js environment variables: https://nodejs.org/api/environment_variables.html (use for missing/blank/whitespace key handling semantics).
- Cucumber guides: https://cucumber.io/docs/guides/ (use for BDD feature/step structure while updating provider status scenarios).
- Jest: Context7 `/jestjs/jest` (use for route-level unit/contract assertions).

#### Subtasks

1. [ ] Implement canonical `/ingest/models` response envelope and lock source. Files (read/edit): `server/src/routes/ingestModels.ts`, shared lock resolver (`server/src/ingest/chromaClient.ts` or canonical helper), and remove placeholder read usage from `server/src/ingest/modelLock.ts`. Required behavior: response must include `models`, `lock`, `openai`, and `lmstudio`, and use the same lock resolver as ingest runtime. Docs: https://spec.openapis.org/oas/v3.0.3.html.
2. [ ] Add deterministic OpenAI status machine and codes. Files (read/edit): `server/src/routes/ingestModels.ts` and related response-shape types/helpers. Required behavior: implement exactly `OPENAI_DISABLED`, `OPENAI_OK`, `OPENAI_ALLOWLIST_NO_MATCH`, `OPENAI_MODELS_LIST_TEMPORARY_FAILURE`, `OPENAI_MODELS_LIST_AUTH_FAILED`, `OPENAI_MODELS_LIST_UNAVAILABLE`. Docs: https://developers.openai.com/api/docs/api-reference/models/list.
3. [ ] Normalize missing-key detection. Files (read/edit): `server/src/routes/ingestModels.ts` and env helper used by this route. Required behavior: missing/blank/whitespace `OPENAI_EMBEDDING_KEY` always maps to `openai.status="disabled"` and no OpenAI API call is attempted. Docs: https://nodejs.org/api/environment_variables.html.
4. [ ] Keep LM Studio options available when OpenAI is warning/disabled. Files (read/edit): `server/src/routes/ingestModels.ts` and LM Studio model-list helper path used there. Required behavior: OpenAI failures must not remove successful LM Studio options. Docs: https://expressjs.com/en/guide/error-handling.html.
5. [ ] Enforce strict OpenAI allowlist and ordering. Files (read/edit): `server/src/routes/ingestModels.ts` and any new helper explicitly created in this subtask (for example `server/src/ingest/openaiAllowlist.ts`). Required behavior: output OpenAI options as `allowlist ∩ models.list()` only, with deterministic order `text-embedding-3-small` then `text-embedding-3-large`. Docs: https://developers.openai.com/api/docs/api-reference/models/list.
6. [ ] Enforce warning-payload rules for no-match and transient failures. Files (read/edit): `server/src/routes/ingestModels.ts` and warning metadata types/helpers. Required behavior: `OPENAI_ALLOWLIST_NO_MATCH` sets `openai.warning.retryable=false`; omit `openai.warning` when status is `ok` or `disabled`. Docs: https://spec.openapis.org/oas/v3.0.3.html.
7. [ ] Add deterministic LM Studio status envelope in the same `200` response. Files (read/edit): `server/src/routes/ingestModels.ts` and LM Studio list wrapper helper. Required behavior: include `lmstudio.status`, `lmstudio.statusCode`, and optional `lmstudio.warning`; do not emit route-level `502` for LM Studio-only failures. Docs: https://expressjs.com/en/guide/error-handling.html.
8. [ ] Treat invalid or unreachable `LMSTUDIO_BASE_URL` as warning metadata, not endpoint failure. Files (read/edit): `server/src/routes/ingestModels.ts`, relevant LM Studio client helper/config parser. Required behavior: return `200` with LM Studio warning and still include OpenAI options when available. Docs: https://nodejs.org/api/environment_variables.html.
9. [ ] Keep compatibility alias behavior explicit. Files (read/edit): `server/src/routes/ingestModels.ts` and lock mapping helper. Required behavior: `lockedModelId` must mirror `lock.embeddingModel`, and `lock` must be `null` when no lock exists. Docs: https://spec.openapis.org/oas/v3.0.3.html.
10. [ ] Add BDD scenario for missing-key OpenAI disabled envelope. Test type: BDD (Cucumber). Location: `server/src/test/features/ingest-models.feature` + matching step definitions in `server/src/test/steps/ingest-models.steps.ts`. Description: assert missing/blank/whitespace key returns `200` with `openai.status=disabled` and LM Studio options still render when available. Purpose: lock deterministic disabled-state behavior. Files (read/edit): `server/src/test/features/ingest-models.feature`, `server/src/test/steps/ingest-models.steps.ts`. Docs: https://cucumber.io/docs/guides/overview/.
11. [ ] Add BDD scenario for transient OpenAI listing failure envelope. Test type: BDD (Cucumber). Location: `server/src/test/features/ingest-models.feature` + step definitions in `server/src/test/steps/ingest-models.steps.ts`. Description: assert transient OpenAI listing failure returns `200` with `OPENAI_MODELS_LIST_TEMPORARY_FAILURE` while preserving LM Studio options. Purpose: guarantee partial-provider resilience contract. Files (read/edit): `server/src/test/features/ingest-models.feature`, `server/src/test/steps/ingest-models.steps.ts`. Docs: https://cucumber.io/docs/guides/overview/.
12. [ ] Add BDD scenario for allowlist-no-match warning envelope. Test type: BDD (Cucumber). Location: `server/src/test/features/ingest-models.feature` + step definitions in `server/src/test/steps/ingest-models.steps.ts`. Description: assert successful model listing with no allowlist intersection returns `OPENAI_ALLOWLIST_NO_MATCH`, no OpenAI models, and `retryable=false`. Purpose: enforce strict allowlist behavior without treating it as transient failure. Files (read/edit): `server/src/test/features/ingest-models.feature`, `server/src/test/steps/ingest-models.steps.ts`. Docs: https://cucumber.io/docs/guides/overview/.
13. [ ] Add route unit test for missing and blank key normalization. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-models.test.ts`. Description: assert missing and blank key paths map to deterministic `openai.status/statusCode` with no OpenAI API call. Purpose: prevent regressions in key-gating logic. Files (read/edit): `server/src/test/unit/ingest-models.test.ts`. Docs: https://jestjs.io/docs/getting-started.
14. [ ] Add route unit test for strict allowlist filtering and deterministic ordering. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-models.test.ts`. Description: assert OpenAI output is exactly `allowlist ∩ models.list()` ordered `text-embedding-3-small` then `text-embedding-3-large`. Purpose: enforce deterministic model options contract. Files (read/edit): `server/src/test/unit/ingest-models.test.ts`. Docs: https://jestjs.io/docs/getting-started.
15. [ ] Add route unit test for invalid/unreachable `LMSTUDIO_BASE_URL` warning behavior. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-models.test.ts`. Description: assert route returns `200` with LM Studio warning envelope and preserves OpenAI options when available. Purpose: keep LM Studio failures non-fatal at contract level. Files (read/edit): `server/src/test/unit/ingest-models.test.ts`. Docs: https://jestjs.io/docs/getting-started.
16. [ ] Add route unit test for both-providers-fail envelope behavior. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-models.test.ts`. Description: assert route returns `200` with deterministic warning envelopes and empty `models` array when LM Studio and OpenAI listings both fail. Purpose: guarantee endpoint stability under full upstream outage. Files (read/edit): `server/src/test/unit/ingest-models.test.ts`. Docs: https://jestjs.io/docs/getting-started.
17. [ ] Add route unit test for `OPENAI_MODELS_LIST_AUTH_FAILED` mapping. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-models.test.ts`. Description: assert auth/list failure maps to `OPENAI_MODELS_LIST_AUTH_FAILED` with correct warning metadata and `200` envelope response. Purpose: enforce deterministic non-transient OpenAI status mapping. Files (read/edit): `server/src/test/unit/ingest-models.test.ts`. Docs: https://developers.openai.com/api/docs/api-reference/models/list.
18. [ ] Add route unit test for `OPENAI_MODELS_LIST_UNAVAILABLE` mapping. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-models.test.ts`. Description: assert upstream unavailable/list failure maps to `OPENAI_MODELS_LIST_UNAVAILABLE` with correct warning metadata and `200` envelope response. Purpose: enforce deterministic OpenAI availability mapping. Files (read/edit): `server/src/test/unit/ingest-models.test.ts`. Docs: https://developers.openai.com/api/docs/api-reference/models/list.
19. [ ] Add schema-level assertions for `/ingest/models` model-entry field shape. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-models.test.ts`. Description: assert each model item includes only `id`, `displayName`, and `provider` fields with deterministic ordering. Purpose: prevent accidental response-shape expansion/regressions. Files (read/edit): `server/src/test/unit/ingest-models.test.ts`. Docs: https://spec.openapis.org/oas/v3.0.3.html.
20. [ ] Update markdown document `design.md` for Task 8 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document `/ingest/models` deterministic status machine (`openai` and `lmstudio`) and allowlist/warning envelope behavior with Mermaid diagrams that match implementation. Purpose: keep server-message contract behavior explicit and reviewable. Files (read/edit): `design.md`, plus Task 8 implementation files for verification (`server/src/routes/ingestModels.ts`, lock resolver helper touched, LM Studio/OpenAI model-list helpers touched). Docs: Context7 `/mermaid-js/mermaid`, https://spec.openapis.org/oas/v3.0.3.html, and https://developers.openai.com/api/docs/api-reference/models/list.
21. [ ] Add `/ingest/models` contract logs for provider summaries and warning envelopes. Files (read/edit): `server/src/routes/ingestModels.ts` plus any provider-status helper modules used by the route. Required log lines: `DEV-0000036:T8:ingest_models_response_summary` (expected per-provider counts and selected defaults) and `DEV-0000036:T8:ingest_models_warning_status` (expected `openai.statusCode` and `retryable` when warnings are emitted). Purpose: prove the message contract and warning taxonomy emitted by `/ingest/models`.
22. [ ] Update markdown document `projectStructure.md` for Task 8 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 8 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 8 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `None planned` (existing route/feature/step/test files are expected to be edited in place unless a new test helper is introduced). Removed files: `None planned`.
23. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: open ingest models UI at `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T8:ingest_models_response_summary` and `DEV-0000036:T8:ingest_models_warning_status` whenever warning envelopes are returned. Expected outcome: warning/status logs match displayed state and browser debug console has zero errors.
9. [ ] `npm run compose:down`

10. [ ] `npm run test:unit --workspace server`
11. [ ] Confirm `/ingest/models` route tests cover missing/blank key, success, transient failure, strict `allowlist ∩ models.list()` filtering, allowlist no-match (`retryable=false`), deterministic allowlist ordering, invalid `LMSTUDIO_BASE_URL`, LM Studio failure-only, and both-providers-fail cases.
12. [ ] Confirm updated `ingest-models` Cucumber scenarios pass with deterministic `200` warning-envelope assertions.
13. [ ] Confirm `/ingest/models` tests explicitly cover `OPENAI_MODELS_LIST_AUTH_FAILED` and `OPENAI_MODELS_LIST_UNAVAILABLE` status mappings.

#### Implementation notes

- Notes added during implementation.

---

### 9. Server Messages: ingest start/reembed/vector-search request and error contracts

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Implement provider-aware request/response contracts for ingest start and vector search error surfaces while preserving backward compatibility for legacy clients.

#### Documentation Locations

- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification (use for classic MCP error payload consistency).
- OpenAPI 3.0.3: https://spec.openapis.org/oas/v3.0.3.html (use for ingest start/reembed/vector-search REST contract definitions).
- OpenAI models list API: https://developers.openai.com/api/docs/api-reference/models/list (use for allowlist validation behavior in start/reembed paths).
- OpenAI embeddings guide: https://developers.openai.com/api/docs/guides/embeddings/ (use for provider-specific failure taxonomy context and deterministic mapping).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating request/error contract diagrams in `design.md`).
- TypeScript handbook: https://www.typescriptlang.org/docs/ (use for normalized error object and compatibility type modeling).
- Cucumber guides: https://cucumber.io/docs/guides/ (use for BDD updates on canonical+legacy behavior).
- Jest: Context7 `/jestjs/jest` (use for regression tests covering payload/field compatibility).

#### Subtasks

1. [ ] Add canonical ingest-start request fields. Files (read/edit): `server/src/routes/ingestStart.ts`. Constraint: accept `embeddingProvider` + `embeddingModel` while preserving legacy `model` compatibility. Docs: OpenAPI https://spec.openapis.org/oas/v3.0.3.html.
2. [ ] Make canonical fields authoritative when both canonical+legacy are present. Files (read/edit): `server/src/ingest/ingestJob.ts`, `server/src/routes/ingestStart.ts`. Constraint: when both are provided, use `embeddingProvider`/`embeddingModel` and ignore legacy `model` for execution decisions. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
3. [ ] Update lock-conflict response body shape. Files (read/edit): `server/src/routes/ingestStart.ts`, `server/src/ingest/chromaClient.ts`. Constraint: include canonical `lock` object and keep compatibility alias `lockedModelId` synchronized to `lock.embeddingModel`. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
4. [ ] Enforce OpenAI allowlist at ingest-start validation. Files (read/edit): `server/src/routes/ingestStart.ts`, shared validation helper(s). Constraint: reject non-allowlisted OpenAI model ids deterministically. Docs: https://developers.openai.com/api/docs/api-reference/models/list.
5. [ ] Enforce `/ingest/reembed/:root` lock-derived provider/model contract. Files (read/edit): `server/src/routes/ingestReembed.ts`, `server/src/ingest/reingestService.ts`, `server/src/ingest/ingestJob.ts`. Constraint: resolve provider/model from lock metadata with canonical-first + legacy fallback, and reject any silent provider/model switching. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
6. [ ] Enforce OpenAI allowlist during re-embed validation. Files (read/edit): `server/src/routes/ingestReembed.ts`, `server/src/ingest/reingestService.ts`, `server/src/ingest/ingestJob.ts`. Constraint: apply the same OpenAI allowlist rules used by `/ingest/start` and reject non-allowlisted models deterministically. Docs: https://developers.openai.com/api/docs/api-reference/models/list and https://spec.openapis.org/oas/v3.0.3.html.
7. [ ] Normalize vector-search OpenAI error mapping. Files (read/edit): `server/src/lmstudio/toolService.ts`. Constraint: map OpenAI failures to normalized payload fields (`error`, `message`, `retryable`, `provider`, optional `upstreamStatus`, `retryAfterMs`) using the same taxonomy for REST and MCP surfaces. Docs: https://www.jsonrpc.org/specification and https://developers.openai.com/api/docs/guides/embeddings/.
8. [ ] Keep `/tools/vector-search` success payload unchanged. Files (read/edit): `server/src/routes/toolsVectorSearch.ts`. Constraint: change only error envelope behavior; success payload fields must remain backward-compatible. Docs: https://spec.openapis.org/oas/v3.0.3.html.
9. [ ] Enforce required normalized error fields across surfaces. Files (read/edit): `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsVectorSearch.ts`, `server/src/mcp/server.ts`, `server/src/lmstudio/tools.ts`. Constraint: required fields are `error`, `message`, `retryable`, `provider`; optional fields are `upstreamStatus`, `retryAfterMs`, and no extra ad-hoc fields. Docs: https://www.jsonrpc.org/specification and https://spec.openapis.org/oas/v3.0.3.html.
10. [ ] Normalize ingest-run error surfaces without breaking legacy consumers. Files (read/edit): `server/src/routes/ingestStatus.ts`, `server/src/routes/ingestRoots.ts`, `server/src/ingest/ingestJob.ts`. Constraint: emit normalized error objects while keeping legacy-compatible string `lastError` behavior for existing clients. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.typescriptlang.org/docs/.
11. [ ] Preserve progress accounting on partial-write failure. Files (read/edit): `server/src/ingest/ingestJob.ts`, `server/src/routes/ingestStatus.ts`, `server/src/routes/ingestRoots.ts`. Constraint: keep counters accurate when failures happen after partial writes and persist normalized `lastError`. Docs: https://www.typescriptlang.org/docs/ and https://spec.openapis.org/oas/v3.0.3.html.
12. [ ] Enforce deterministic `OPENAI_MODEL_UNAVAILABLE` behavior. Files (read/edit): `server/src/routes/ingestStart.ts`, `server/src/routes/ingestReembed.ts`, `server/src/lmstudio/toolService.ts`, `server/src/mcp/server.ts`. Constraint: unavailable OpenAI model must return `OPENAI_MODEL_UNAVAILABLE` with no silent provider/model fallback. Docs: https://developers.openai.com/api/docs/api-reference/models/list and https://www.jsonrpc.org/specification.
13. [ ] Keep one shared error mapping path across REST/MCP/ingest. Files (read/edit): `server/src/lmstudio/toolService.ts`, `server/src/mcp/server.ts`. Constraint: one canonical translation path, no duplicated formatter logic. Docs: JSON-RPC spec https://www.jsonrpc.org/specification.
14. [ ] Align LM Studio tool wrappers with shared mapping. Files (read/edit): `server/src/lmstudio/tools.ts`. Constraint: match REST and classic MCP behavior exactly. Docs: JSON-RPC spec https://www.jsonrpc.org/specification.
15. [ ] Ensure secret-safe error/log output across surfaces. Files (read/edit): `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsVectorSearch.ts`, `server/src/lmstudio/tools.ts`, `server/src/mcp/server.ts`, `server/src/routes/ingestStatus.ts`, `server/src/routes/ingestRoots.ts`. Constraint: never emit keys/headers/tokens. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
16. [ ] Add ingest-start canonical-precedence scenario. Test type: BDD (Cucumber). Location: `server/src/test/features/ingest-start-body.feature` + step definitions in `server/src/test/steps/ingest-start-body.steps.ts`. Description: assert canonical `embeddingProvider`/`embeddingModel` take precedence when legacy `model` is also sent. Purpose: remove ambiguity in compatibility request handling. Files (read/edit): `server/src/test/features/ingest-start-body.feature`, `server/src/test/steps/ingest-start-body.steps.ts`. Docs: https://cucumber.io/docs/guides/overview/.
17. [ ] Add re-embed lock-derived-provider scenario. Test type: BDD (Cucumber). Location: `server/src/test/features/ingest-reembed.feature` + step definitions in `server/src/test/steps/ingest-manage.steps.ts`. Description: assert re-embed always resolves provider/model from lock metadata (canonical-first, legacy fallback) and cannot silently switch. Purpose: enforce lock-derived behavior in re-embed flows. Files (read/edit): `server/src/test/features/ingest-reembed.feature`, `server/src/test/steps/ingest-manage.steps.ts`. Docs: https://cucumber.io/docs/guides/overview/.
18. [ ] Add ingest-start request-mapping test for canonical and legacy input. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-start.test.ts`. Description: assert legacy `model` maps to LM Studio compatibility path and canonical fields map directly without ambiguity. Purpose: preserve backward compatibility while introducing canonical contract. Files (read/edit): `server/src/test/unit/ingest-start.test.ts`. Docs: https://jestjs.io/docs/getting-started.
19. [ ] Add ingest-start allowlist-rejection test for non-allowlisted OpenAI model ids. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-start.test.ts`. Description: assert deterministic validation error when OpenAI model id is outside curated allowlist. Purpose: block contract bypass attempts at ingest start. Files (read/edit): `server/src/test/unit/ingest-start.test.ts`. Docs: https://developers.openai.com/api/docs/api-reference/models/list.
20. [ ] Add lock-conflict payload contract test. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-start.test.ts`. Description: assert `409 MODEL_LOCKED` includes canonical `lock` object plus compatibility `lockedModelId` alias. Purpose: keep conflict payload stable for new and legacy clients. Files (read/edit): `server/src/test/unit/ingest-start.test.ts`. Docs: https://spec.openapis.org/oas/v3.0.3.html.
21. [ ] Add REST vector-search normalized-error contract test. Test type: Unit (Jest). Location: `server/src/test/unit/tools-vector-search.test.ts`. Description: assert REST `/tools/vector-search` errors include required normalized fields (`error`, `message`, `retryable`, `provider`) and optional metadata shape. Purpose: lock error-contract behavior while preserving success payload. Files (read/edit): `server/src/test/unit/tools-vector-search.test.ts`. Docs: https://jestjs.io/docs/getting-started.
22. [ ] Add classic MCP `VectorSearch` normalized-error contract test. Test type: Unit (Jest). Location: `server/src/test/unit/mcp-vector-search.test.ts`. Description: assert classic MCP error mappings match REST normalized taxonomy and metadata semantics for equivalent failures. Purpose: guarantee cross-surface mapping parity. Files (read/edit): `server/src/test/unit/mcp-vector-search.test.ts`. Docs: https://www.jsonrpc.org/specification.
23. [ ] Add ingest status/roots normalized-error compatibility test. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-status.test.ts` and `server/src/test/unit/ingest-roots-dedupe.test.ts`. Description: assert normalized error objects are emitted while legacy string-compatible `lastError` behavior remains intact. Purpose: prevent client breakage during error-contract migration. Files (read/edit): `server/src/test/unit/ingest-status.test.ts`, `server/src/test/unit/ingest-roots-dedupe.test.ts`. Docs: https://spec.openapis.org/oas/v3.0.3.html.
24. [ ] Add partial-write failure progress-accounting test. Test type: Integration (Jest). Location: `server/src/test/integration/ingest-progress-accounting.test.ts`. Description: assert progress counters remain accurate when failures happen after partial writes and normalized `lastError` is persisted. Purpose: protect ingest run diagnostics and retry decisions. Files (read/edit): `server/src/test/integration/ingest-progress-accounting.test.ts`. Docs: https://jestjs.io/docs/getting-started.
25. [ ] Add secret-redaction test for ingest/vector-search/MCP error surfaces. Test type: Unit (Jest). Location: `server/src/test/unit/tools-vector-search.test.ts`, `server/src/test/unit/ingest-start.test.ts`, and `server/src/test/unit/mcp-vector-search.test.ts`. Description: assert error payloads/log metadata never expose key/header/token material. Purpose: enforce security requirements across all surfaces changed in this task. Files (read/edit): `server/src/test/unit/tools-vector-search.test.ts`, `server/src/test/unit/ingest-start.test.ts`, `server/src/test/unit/mcp-vector-search.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/.
26. [ ] Add cross-surface parity test for equivalent OpenAI failures. Test type: Integration (Jest). Location: `server/src/test/integration/openai-error-parity.test.ts`. Description: assert the same upstream failure maps to the same normalized code and retryability semantics in REST `/tools/vector-search`, classic MCP `VectorSearch`, and ingest-run status/error outputs. Purpose: ensure one canonical failure taxonomy externally. Files (read/edit): `server/src/test/integration/openai-error-parity.test.ts`. Docs: https://www.jsonrpc.org/specification.
27. [ ] Add provider-locked OpenAI happy-path integration flow test. Test type: Integration (Jest). Location: `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`. Description: assert OpenAI ingest start succeeds, re-embed reuses stored lock provider/model, and vector-search uses same lock identity. Purpose: prove end-to-end provider-lock happy path. Files (read/edit): `server/src/test/integration/chat-vectorsearch-locked-model.test.ts`. Docs: https://developers.openai.com/api/docs/guides/embeddings/ and Context7 `/chroma-core/chroma`.
28. [ ] Add re-embed invalid-state rejection integration test. Test type: Integration (Jest). Location: `server/src/test/integration/ingest-reembed-invalid-state.test.ts`. Description: assert re-embed requests against `cancelled`/`error` roots with stale metadata are rejected with deterministic validation errors before run start. Purpose: guarantee the edge-case contract for invalid re-embed eligibility states. Files (read/edit): `server/src/test/integration/ingest-reembed-invalid-state.test.ts`. Docs: https://jestjs.io/docs/getting-started.
29. [ ] Add explicit `OPENAI_MODEL_UNAVAILABLE` and allowlist-enforcement contract tests across ingest/re-embed/vector-search surfaces. Test type: Integration (Jest). Location: `server/src/test/integration/openai-model-unavailable-contract.test.ts`. Description: assert unavailable locked/selected OpenAI model maps to deterministic `OPENAI_MODEL_UNAVAILABLE` behavior with no silent provider/model fallback in ingest start, re-embed, and REST/classic vector-search flows; also assert re-embed rejects roots locked to non-allowlisted OpenAI models (including legacy/stale lock metadata) with deterministic validation and no fallback model substitution. Purpose: lock down model-unavailable and allowlist-bypass edge cases across all affected interfaces. Files (read/edit): `server/src/test/integration/openai-model-unavailable-contract.test.ts`. Docs: https://developers.openai.com/api/docs/api-reference/models/list and https://www.jsonrpc.org/specification.
30. [ ] Update markdown document `design.md` for Task 9 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document canonical request/response precedence, lock-conflict payload shape, and normalized error mapping flow across REST and classic MCP with Mermaid diagrams matching implementation. Purpose: keep cross-surface error/contract behavior explicit and auditable. Files (read/edit): `design.md`, plus Task 9 implementation files for verification (`server/src/routes/ingestStart.ts`, `server/src/routes/ingestReembed.ts`, `server/src/routes/toolsVectorSearch.ts`, `server/src/lmstudio/toolService.ts`, `server/src/lmstudio/tools.ts`, `server/src/mcp/server.ts`, `server/src/routes/ingestStatus.ts`, `server/src/routes/ingestRoots.ts`). Docs: Context7 `/mermaid-js/mermaid`, https://spec.openapis.org/oas/v3.0.3.html, and https://www.jsonrpc.org/specification.
31. [ ] Add ingest/reembed/vector-search contract logs for request validation and error mapping. Files (read/edit): `server/src/routes/ingestStart.ts`, `server/src/routes/toolsVectorSearch.ts` (or equivalent vector-search route file), `server/src/mcp/server.ts`, and shared error mapping utilities used in this task. Required log lines: `DEV-0000036:T9:ingest_request_contract_validated` (expected endpoint + canonical provider/model fields + validation result) and `DEV-0000036:T9:openai_error_contract_mapped` (expected canonical code plus REST/MCP status mapping). Purpose: verify cross-surface contract consistency during failures and successes.
32. [ ] Update markdown document `projectStructure.md` for Task 9 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 9 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 9 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `server/src/test/integration/openai-error-parity.test.ts`, `server/src/test/integration/ingest-reembed-invalid-state.test.ts`, and `server/src/test/integration/openai-model-unavailable-contract.test.ts` (if created by subtasks 26-29). Removed files: `None planned`.
33. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: trigger ingest start/reembed/vector-search flows from `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T9:ingest_request_contract_validated` and `DEV-0000036:T9:openai_error_contract_mapped` for success/failure paths. Expected outcome: logged contract mapping matches API responses and browser debug console has zero errors.
9. [ ] `npm run compose:down`

10. [ ] `npm run test:unit --workspace server`
11. [ ] `npm run test:integration --workspace server`
12. [ ] Confirm `server/src/test/unit/tools-vector-search.test.ts`, `server/src/test/unit/lmstudio-tools.test.ts` (or equivalent LM Studio tools suite), classic MCP vector-search error tests, and ingest-start route tests pass.
13. [ ] Confirm vector-search success-shape regression tests pass (no contract changes on success path).
14. [ ] Confirm ingest status/roots error-shape tests pass for normalized OpenAI failure payloads with backward-compatible `lastError` behavior and accurate partial-write progress accounting.
15. [ ] Confirm updated ingest-start/reembed Cucumber scenarios pass.
16. [ ] Confirm secret-safety redaction tests pass for ingest/vector-search/MCP error payloads and logs.
17. [ ] Confirm cross-surface parity tests pass for equivalent OpenAI failures across REST, classic MCP, and ingest-run error surfaces.
18. [ ] Confirm OpenAI happy-path integration tests pass for ingest start -> re-embed -> vector-search using locked provider/model identity.
19. [ ] Confirm re-embed invalid-state tests pass for deterministic rejection of `cancelled`/`error` root states before run start.
20. [ ] Confirm `OPENAI_MODEL_UNAVAILABLE` and re-embed allowlist-enforcement contract tests pass across ingest start, re-embed, REST vector-search, and classic MCP vector-search with no silent fallback or model substitution.

#### Implementation notes

- Notes added during implementation.

---

### 10. Server Messages: `/ingest/roots`, `/tools/ingested-repos`, classic MCP `ListIngestedRepositories`, and schema docs

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Finalize the remaining message-contract surfaces so canonical lock/provider fields and compatibility aliases are consistent everywhere, including classic MCP wrapped JSON outputs and OpenAPI docs.

#### Documentation Locations

- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification (use for classic MCP list output and error envelope parity).
- OpenAPI 3.0.3: https://spec.openapis.org/oas/v3.0.3.html (use for REST schema alignment in roots/repos endpoints).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating contract-alignment diagrams in `design.md`).
- Cucumber guides: https://cucumber.io/docs/guides/ (use for BDD feature/step updates across roots/manage scenarios).
- Jest: Context7 `/jestjs/jest` (use for unit/integration contract parity and schema assertions).

#### Subtasks

1. [ ] Add canonical per-root + lock fields to `/ingest/roots`. Files (read/edit): `server/src/routes/ingestRoots.ts`. Constraint: preserve legacy aliases while adding canonical fields. Docs: OpenAPI https://spec.openapis.org/oas/v3.0.3.html.
2. [ ] Add canonical fields to `/tools/ingested-repos`. Files (read/edit): `server/src/lmstudio/toolService.ts` (`listIngestedRepositories`) and `server/src/routes/toolsIngestedRepos.ts`. Constraint: keep route wrapper thin and service-centric. Docs: JSON-RPC spec https://www.jsonrpc.org/specification.
3. [ ] Update classic MCP `ListIngestedRepositories` output shape. Files (read/edit): `server/src/mcp/server.ts`. Constraint: payload parity with REST contract plus compatibility aliases. Docs: JSON-RPC spec https://www.jsonrpc.org/specification.
4. [ ] Enforce alias synchronization matrix across all lock-bearing responses. Files (read/edit): `server/src/routes/ingestRoots.ts`, `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`. Constraint: `lock.embeddingModel` must match alias fields (`lockedModelId`, `modelId`, legacy root `model`) for the same record in every response surface. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://www.jsonrpc.org/specification.
5. [ ] Add canonical+alias parity scenario for `/ingest/roots`. Test type: BDD (Cucumber). Location: `server/src/test/features/ingest-roots.feature` + `server/src/test/steps/ingest-manage.steps.ts`. Description: assert root entries and lock fields include canonical provider/model fields while preserving legacy aliases. Purpose: verify roots contract migration stays backward compatible. Files (read/edit): `server/src/test/features/ingest-roots.feature`, `server/src/test/steps/ingest-manage.steps.ts`. Docs: https://cucumber.io/docs/guides/overview/.
6. [ ] Add canonical+alias parity scenario for ingest-remove manage flow. Test type: BDD (Cucumber). Location: `server/src/test/features/ingest-remove.feature` + step definitions in `server/src/test/steps/ingest-manage.steps.ts`. Description: assert ingest remove flow responses continue exposing legacy aliases alongside canonical lock fields. Purpose: prevent regressions in ingest management workflows. Files (read/edit): `server/src/test/features/ingest-remove.feature`, `server/src/test/steps/ingest-manage.steps.ts`. Docs: https://cucumber.io/docs/guides/overview/.
7. [ ] Add REST contract test for `/ingest/roots` canonical and alias fields. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-roots-dedupe.test.ts`. Description: assert response includes canonical lock/root fields and synchronized aliases for the same fixture state. Purpose: enforce REST roots contract parity. Files (read/edit): `server/src/test/unit/ingest-roots-dedupe.test.ts`. Docs: https://jestjs.io/docs/getting-started.
8. [ ] Add REST contract test for `/tools/ingested-repos` canonical and alias fields. Test type: Unit (Jest). Location: `server/src/test/unit/tools-ingested-repos.test.ts`. Description: assert repo entries expose canonical provider/model/dimensions and compatibility alias fields with synchronized values. Purpose: enforce tool-route contract parity. Files (read/edit): `server/src/test/unit/tools-ingested-repos.test.ts`. Docs: https://jestjs.io/docs/getting-started.
9. [ ] Add classic MCP contract test for `ListIngestedRepositories` canonical and alias fields. Test type: Integration (Jest). Location: `server/src/test/integration/mcp-ingested-repositories.test.ts`. Description: assert classic MCP wrapped output matches REST canonical+alias contract semantics. Purpose: preserve MCP/REST contract alignment. Files (read/edit): `server/src/test/integration/mcp-ingested-repositories.test.ts`. Docs: https://www.jsonrpc.org/specification.
10. [ ] Update OpenAPI contract file with implemented schemas. Files (read/edit): `openapi.json`. Constraint: include all listed endpoints with provider status/warning envelopes and normalized error fields. Docs: OpenAPI https://spec.openapis.org/oas/v3.0.3.html.
11. [ ] Add OpenAPI schema test for `/ingest/roots` path field coverage. Test type: Unit (Jest). Location: `server/src/test/unit/openapi.contract.test.ts`. Description: assert `/ingest/roots` schema includes canonical lock fields and compatibility aliases exactly as implemented. Purpose: prevent docs/runtime drift for roots contract. Files (read/edit): `server/src/test/unit/openapi.contract.test.ts`. Docs: OpenAPI https://spec.openapis.org/oas/v3.0.3.html.
12. [ ] Add OpenAPI schema test for `/tools/ingested-repos` path field coverage. Test type: Unit (Jest). Location: `server/src/test/unit/openapi.contract.test.ts`. Description: assert `/tools/ingested-repos` schema covers canonical repo fields, lock fields, and legacy aliases. Purpose: keep OpenAPI contract synchronized with runtime response. Files (read/edit): `server/src/test/unit/openapi.contract.test.ts`. Docs: OpenAPI https://spec.openapis.org/oas/v3.0.3.html.
13. [ ] Add same-model-id contract test across providers for REST roots/repos responses. Test type: Unit (Jest). Location: `server/src/test/unit/ingest-roots-dedupe.test.ts` and `server/src/test/unit/tools-ingested-repos.test.ts`. Description: assert equal model-id strings from different providers remain provider-qualified and unambiguous in canonical+alias fields. Purpose: prevent identity collapse in REST payloads. Files (read/edit): `server/src/test/unit/ingest-roots-dedupe.test.ts`, `server/src/test/unit/tools-ingested-repos.test.ts`. Docs: https://spec.openapis.org/oas/v3.0.3.html.
14. [ ] Add same-model-id contract test across providers for classic MCP responses. Test type: Integration (Jest). Location: `server/src/test/integration/mcp-ingested-repositories.test.ts`. Description: assert MCP output preserves provider-qualified identity when model ids collide across providers. Purpose: prevent ambiguous model selection in MCP clients. Files (read/edit): `server/src/test/integration/mcp-ingested-repositories.test.ts`. Docs: https://www.jsonrpc.org/specification.
15. [ ] Update markdown document `design.md` for Task 10 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document canonical+alias contract alignment across `/ingest/roots`, `/tools/ingested-repos`, and classic MCP `ListIngestedRepositories` with Mermaid diagrams reflecting finalized schema mappings. Purpose: keep contract-alignment behavior clear for both REST and MCP consumers. Files (read/edit): `design.md`, plus Task 10 implementation files for verification (`server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/lmstudio/toolService.ts`, `server/src/mcp/server.ts`, `openapi.json`). Docs: Context7 `/mermaid-js/mermaid`, https://spec.openapis.org/oas/v3.0.3.html, and https://www.jsonrpc.org/specification.
16. [ ] Add ingest-repository response logs for canonical+compat field emission. Files (read/edit): `server/src/routes/ingestRoots.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/mcp/server.ts`, and schema export files updated by this task. Required log lines: `DEV-0000036:T10:ingest_repo_payload_emitted` (expected canonical `embeddingProvider`/`embeddingModel`/`embeddingDimensions` plus alias-presence flags) and `DEV-0000036:T10:ingest_repo_schema_version_emitted` (expected schema/version id used by docs/tests). Purpose: show payload/schema parity across REST and classic MCP surfaces.
17. [ ] Update markdown document `projectStructure.md` for Task 10 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 10 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 10 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `None planned` (Task 10 is expected to update existing route/schema/feature files). Removed files: `None planned`.
18. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: view roots and ingested-repos flows from `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T10:ingest_repo_payload_emitted` and `DEV-0000036:T10:ingest_repo_schema_version_emitted` with canonical+alias fields. Expected outcome: emitted log payload matches rendered data/contracts and browser debug console has zero errors.
9. [ ] `npm run compose:down`

10. [ ] `npm run test:unit --workspace server`
11. [ ] `npm run test:integration --workspace server`
12. [ ] Confirm MCP server integration tests pass.
13. [ ] Confirm updated ingest-roots/ingest-remove Cucumber scenarios pass.
14. [ ] Confirm contract tests pass for same model-id across providers with provider-qualified identity preserved in REST and classic MCP responses.

#### Implementation notes

- Notes added during implementation.

---

### 11. Server: Update transitive runtime consumers to canonical+compat ingest repo contracts

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Align server-side transitive consumers that depend on ingest repository/tool payload shapes so contract migrations do not break flows, agents, AST tools, shared runtime types, or MCP v2 codebase-question summaries.

#### Documentation Locations

- TypeScript handbook: https://www.typescriptlang.org/docs/ (use for canonical-first type evolution with compatibility aliases).
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification (use for tool payload compatibility across REST/classic pathways).
- Mermaid: Context7 `/mermaid-js/mermaid` (use for `flowchart`/`sequenceDiagram` syntax when updating transitive-consumer flow diagrams in `design.md`).
- Jest: Context7 `/jestjs/jest` (use for regression coverage across flows/agents/AST transitive consumers).

#### Subtasks

1. [ ] Promote canonical ingest-repo fields in shared runtime types. Files (read/edit): `server/src/lmstudio/toolService.ts` (shared result types/interfaces used by routes/tools). Required behavior: canonical fields (`embeddingProvider`, `embeddingModel`, `embeddingDimensions`) are first-class while compatibility aliases remain present for existing consumers. Docs: https://www.typescriptlang.org/docs/handbook/2/types-from-types.html.
2. [ ] Update AST consumer to canonical-first reads with compatibility fallback. Files (read/edit): `server/src/ast/toolService.ts`. Required behavior: selection logic must read canonical fields first and fallback only when canonical fields are absent in legacy data. Docs: https://www.typescriptlang.org/docs/.
3. [ ] Update flow-layer consumers to canonical-first reads with compatibility fallback. Files (read/edit): `server/src/flows/types.ts`, `server/src/flows/discovery.ts`, `server/src/flows/service.ts`. Required behavior: no flow/runtime regression when ingest-repo payload comes from either canonical+alias or legacy-only source. Docs: https://www.typescriptlang.org/docs/ and https://www.jsonrpc.org/specification.
4. [ ] Update agent-layer consumers to canonical-first reads with compatibility fallback. Files (read/edit): `server/src/agents/service.ts`. Required behavior: ingested-repository command discovery continues to function with new contracts and legacy aliases. Docs: https://www.typescriptlang.org/docs/.
5. [ ] Verify REST and classic tool pathways still provide required selection fields. Files (read/edit): `server/src/routes/toolsIngestedRepos.ts`, `server/src/lmstudio/tools.ts`, `server/src/mcp/server.ts`, `server/src/lmstudio/toolService.ts`. Required behavior: responses consumed by flows/agents/AST always include `id`, `containerPath`, and compatibility aliases. Docs: https://www.jsonrpc.org/specification.
6. [ ] Update MCP v2 codebase-question summary consumers to canonical-first compatibility reads. Files (read/edit): `server/src/chat/responders/McpResponder.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`. Required behavior: when ingest/tool payloads include canonical fields, MCP v2 summaries still emit compatible `modelId` for existing clients and do not lose provider-qualified identity. Docs: https://www.jsonrpc.org/specification and https://www.typescriptlang.org/docs/.
7. [ ] Add flows-list regression test for canonical+alias ingest-repo payloads. Test type: Integration (Jest). Location: `server/src/test/integration/flows.list.test.ts`. Description: assert flow listing behavior remains stable when ingest repo payload includes canonical fields with alias fallbacks. Purpose: prevent flow-discovery regressions from contract evolution. Files (read/edit): `server/src/test/integration/flows.list.test.ts`. Docs: https://jestjs.io/docs/getting-started.
8. [ ] Add flows-run regression test for canonical+alias ingest-repo payloads. Test type: Integration (Jest). Location: `server/src/test/integration/flows.run.basic.test.ts`. Description: assert flow execution still resolves repositories correctly with canonical-first and alias-fallback fields. Purpose: keep flow runtime behavior intact after contract migration. Files (read/edit): `server/src/test/integration/flows.run.basic.test.ts`. Docs: https://jestjs.io/docs/getting-started.
9. [ ] Add agent-commands regression test for canonical+alias ingest-repo payloads. Test type: Unit (Jest). Location: `server/src/test/unit/agent-commands-list.test.ts`. Description: assert agent command discovery still works when ingest-repo fields are canonical-first with compatibility aliases. Purpose: protect agent command tooling from contract changes. Files (read/edit): `server/src/test/unit/agent-commands-list.test.ts`. Docs: https://jestjs.io/docs/getting-started.
10. [ ] Add AST tools regression test for canonical+alias ingest-repo payloads. Test type: Integration (Jest). Location: `server/src/test/integration/tools-ast.test.ts`. Description: assert AST tooling still selects and operates on repositories using canonical-first selection with alias fallback. Purpose: prevent AST workflow breakage from ingest-repo contract migration. Files (read/edit): `server/src/test/integration/tools-ast.test.ts`. Docs: https://jestjs.io/docs/getting-started.
11. [ ] Add MCP v2 `codebase_question` regression test for canonical+alias vector summary compatibility. Test type: Unit (Jest). Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`. Description: assert `codebase_question` responses remain stable (`modelId` still present for compatibility) when canonical embedding fields are present in underlying tool payloads. Purpose: prevent MCP v2 response regressions from ingest contract migration. Files (read/edit): `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`. Docs: https://jestjs.io/docs/getting-started.
12. [ ] Update markdown document `design.md` for Task 11 architecture changes. Document: `design.md`. Location: repository root (`/design.md`). Description: document canonical-first + alias-fallback transitive consumer behavior for flows, agents, AST, and MCP v2 codebase-question summaries with Mermaid diagrams showing repository-selection data flow. Purpose: keep transitive contract-consumer behavior discoverable and testable. Files (read/edit): `design.md`, plus Task 11 implementation files for verification (`server/src/ast/toolService.ts`, `server/src/flows/types.ts`, `server/src/flows/discovery.ts`, `server/src/flows/service.ts`, `server/src/agents/service.ts`, `server/src/lmstudio/toolService.ts`, `server/src/routes/toolsIngestedRepos.ts`, `server/src/lmstudio/tools.ts`, `server/src/mcp/server.ts`, `server/src/chat/responders/McpResponder.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`). Docs: Context7 `/mermaid-js/mermaid`, https://www.typescriptlang.org/docs/, and https://www.jsonrpc.org/specification.
13. [ ] Add transitive-consumer compatibility logs for canonical field adoption and alias fallback. Files (read/edit): transitive runtime consumer files touched in this task (flows services/routes, agent command handlers, AST tools, MCP2 codebase-question path). Required log lines: `DEV-0000036:T11:transitive_consumer_contract_read` (expected consumer name and canonical fields consumed) and `DEV-0000036:T11:transitive_consumer_alias_fallback` (expected `aliasFallbackUsed=true|false` with no runtime errors). Purpose: prove downstream consumers remain compatible during contract migration.
14. [ ] Update markdown document `projectStructure.md` for Task 11 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 11 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 11 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `None planned` (Task 11 is expected to update existing transitive consumer/test files). Removed files: `None planned`.
15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: run transitive consumer workflows via `http://host.docker.internal:5001`; verify server logs include `DEV-0000036:T11:transitive_consumer_contract_read` and `DEV-0000036:T11:transitive_consumer_alias_fallback`. Expected outcome: consumers report canonical reads with expected fallback flags and browser debug console has zero errors.
9. [ ] `npm run compose:down`

10. [ ] `npm run test:unit --workspace server`
11. [ ] `npm run test:integration --workspace server`
12. [ ] Confirm `server/src/test/integration/flows.list.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/unit/agent-commands-list.test.ts`, `server/src/test/integration/tools-ast.test.ts`, and `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` pass.

#### Implementation notes

- Notes added during implementation.

---

### 12. Client: Update ingest data hooks and API types to new server contracts

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Update the client data layer (`useIngestModels`, `useIngestRoots`, related types) to consume canonical server contracts and warning-state envelopes. No major visual/UI behavior changes in this task.

#### Documentation Locations

- MUI MCP docs index: https://llms.mui.com/material-ui/6.4.12/llms.txt (use as canonical component API reference in this environment).
- MUI v6.5.0 release notes: https://github.com/mui/material-ui/releases/tag/v6.5.0 (use to validate compatibility/deprecation behavior against resolved package version).
- React reference: https://react.dev/reference/react (use for hook state/effect and safe normalization patterns).
- Jest: Context7 `/jestjs/jest` (use for hook parsing/error compatibility tests).

#### Subtasks

1. [ ] Extend ingest hook interfaces for new contracts. Files (read/edit): `client/src/hooks/useIngestModels.ts`, `client/src/hooks/useIngestRoots.ts` (and local types used by these hooks). Constraint: extend existing hooks only; do not create parallel hooks. Docs: MUI MCP index https://llms.mui.com/material-ui/6.4.12/llms.txt.
2. [ ] Parse canonical+alias model/lock envelopes safely in hooks. Files (read/edit): `client/src/hooks/useIngestModels.ts`, `client/src/hooks/useIngestRoots.ts`. Constraint: reuse normalization style from `client/src/hooks/useConversations.ts` and `client/src/hooks/useConversationTurns.ts`. Docs: React docs https://react.dev/reference/react.
3. [ ] Parse normalized OpenAI errors while retaining legacy `lastError` compatibility. Files (read/edit): `client/src/hooks/useIngestModels.ts`, `client/src/hooks/useIngestRoots.ts`, and local hook-level type helpers in those files (or extracted helper file created in this task). Constraint: support both object and string `lastError` payloads without changing existing render safety. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://react.dev/reference/react.
4. [ ] Preserve backward-safe handling for older server payloads. Files (read/edit): `client/src/hooks/useIngestModels.ts`, `client/src/hooks/useIngestRoots.ts`. Constraint: missing canonical fields must fall back to legacy aliases and must never throw during staged rollout. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://react.dev/reference/react.
5. [ ] Add ingest-hook parsing test for canonical lock/model envelopes with alias fallback. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert hooks prefer canonical fields and fallback to aliases when canonical fields are absent. Purpose: protect client compatibility during staged backend rollout. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
6. [ ] Add ingest-hook parsing test for normalized error objects and legacy string `lastError`. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert hooks parse both object and string error forms without crashing and preserve existing rendering behavior. Purpose: keep error handling backward compatible. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://react.dev/reference/react.
7. [ ] Add provider-status parsing test for `openai.status=disabled`. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert disabled status is parsed with expected status code and warning fields omitted as defined by contract. Purpose: enforce deterministic disabled-state behavior in hook layer. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
8. [ ] Add provider-status parsing test for `openai.status=ok`. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert ok status parses available OpenAI options and omits warning envelope. Purpose: ensure happy-path parsing remains stable. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
9. [ ] Add provider-status parsing test for `OPENAI_MODELS_LIST_TEMPORARY_FAILURE`. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert warning envelope is parsed with retryable semantics and does not break LM Studio model rendering. Purpose: preserve mixed-provider resilience in hook parsing. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://react.dev/reference/react.
10. [ ] Add provider-status parsing test for `OPENAI_MODELS_LIST_AUTH_FAILED`. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert auth-failed status code maps to warning state and expected metadata in hook output. Purpose: enforce deterministic non-transient auth handling in client data layer. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
11. [ ] Add provider-status parsing test for `OPENAI_MODELS_LIST_UNAVAILABLE`. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert unavailable status code parses correctly and preserves non-crashing fallback behavior. Purpose: validate outage handling in hook layer. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
12. [ ] Add provider-status parsing test for `OPENAI_ALLOWLIST_NO_MATCH`. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert no-match status parses as warning with `retryable=false` and no OpenAI options emitted. Purpose: enforce allowlist contract handling in client parsing. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://react.dev/reference/react.
13. [ ] Add provider-envelope fallback safety test for missing/partial provider objects. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestModels.test.tsx`. Description: assert hooks handle missing or partial `openai`/`lmstudio` envelopes without throw and preserve safe defaults. Purpose: make hook parsing robust against partial rollout payloads. Files (read/edit): `client/src/test/useIngestModels.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
14. [ ] Add `useIngestRoots` parsing test for canonical lock/root envelopes with alias fallback. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestRoots.test.tsx`. Description: assert roots hook prefers canonical root/lock fields and falls back to legacy aliases when canonical fields are absent. Purpose: guarantee hook-level compatibility for root contract migration, not just UI-component rendering. Files (read/edit): `client/src/test/useIngestRoots.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
15. [ ] Add `useIngestRoots` parsing test for normalized and legacy `lastError` payloads. Test type: Unit (Jest + React Testing Library hooks/components). Location: `client/src/test/useIngestRoots.test.tsx`. Description: assert roots hook handles both normalized error-object payloads and legacy string `lastError` payloads safely. Purpose: ensure roots data-layer error parsing remains backward compatible through server rollout. Files (read/edit): `client/src/test/useIngestRoots.test.tsx`. Docs: https://react.dev/reference/react.
16. [ ] Add client ingest-hook normalization logs for model/root contract parsing. Files (read/edit): `client/src/hooks/useIngestModels.ts`, `client/src/hooks/useIngestRoots.ts`, and client logging helpers used by ingest hooks. Required log lines: `DEV-0000036:T12:useIngestModels_normalized` (expected provider counts, default selection, and OpenAI status summary) and `DEV-0000036:T12:useIngestRoots_normalized` (expected canonical lock identity, alias fallback flag, and normalized error-shape marker). Purpose: verify hook-level parsing and fallback behavior during UI-driven checks.
17. [ ] Update markdown document `projectStructure.md` for Task 12 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 12 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 12 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `client/src/test/useIngestModels.test.tsx` and `client/src/test/useIngestRoots.test.tsx` (if created by subtasks 5-15). Removed files: `None planned`.
18. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: exercise ingest hooks through the UI at `http://host.docker.internal:5001`; verify browser debug logs include `DEV-0000036:T12:useIngestModels_normalized` and `DEV-0000036:T12:useIngestRoots_normalized` with expected normalization metadata, then capture screenshots of the ingest page model/lock state and roots list state to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped by `docker-compose.local.yml`) using names `0000036-12-ingest-hooks-model-lock.png` and `0000036-12-ingest-hooks-roots.png`. Expected outcome: hook normalization logs match response fixtures, screenshots are reviewed by the agent against Task 12 GUI expectations, and browser debug console has zero runtime errors.
9. [ ] `npm run compose:down`

10. [ ] Confirm `client/src/test/ingestStatus.test.tsx` and `client/src/test/ingestRoots.test.tsx` pass.
11. [ ] Confirm hook tests cover both legacy string and normalized-object error payload handling.
12. [ ] Confirm normalization-pattern regression suites remain green (`client/src/test/useConversations.source.test.ts` and `client/src/test/useConversationTurns.commandMetadata.test.ts`) so ingest contract parsing changes do not regress shared normalization behavior.
13. [ ] Confirm ingest hook tests pass for the full provider status/warning matrix and legacy fallback handling in both `client/src/test/useIngestModels.test.tsx` and `client/src/test/useIngestRoots.test.tsx`.

#### Implementation notes

- Notes added during implementation.

---

### 13. Client: Ingest UI provider-model selection and info/warning state behavior

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Implement the user-visible ingest UI behavior for provider-tagged model selection, OpenAI info/warning states, and canonical provider/model payload submission.

#### Documentation Locations

- MUI TextField/Select docs: https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (use for provider-qualified select rendering and option state management).
- MUI Alert docs: https://llms.mui.com/material-ui/6.4.12/components/alert.md (use for deterministic info/warning banner behavior).
- React controlled input docs: https://react.dev/reference/react-dom/components/input (use for selection lifecycle, reset, and controlled submission behavior).
- Jest: Context7 `/jestjs/jest` (use for UI contract tests on selection, banners, and payload shape).

#### Subtasks

1. [ ] Render provider-qualified model options in ingest form. Files (read/edit): `client/src/components/ingest/IngestForm.tsx`. Constraint: option labels/values must keep provider+model identity distinct. Docs: MUI TextField/select docs https://llms.mui.com/material-ui/6.4.12/components/text-fields.md.
2. [ ] Add missing-key + warning-state info bars. Files (read/edit): `client/src/components/ingest/IngestForm.tsx`, `client/src/pages/IngestPage.tsx`. Constraint: map directly from `openai.status/statusCode` contract (`OPENAI_DISABLED`, `OPENAI_MODELS_LIST_TEMPORARY_FAILURE`, `OPENAI_MODELS_LIST_AUTH_FAILED`, `OPENAI_MODELS_LIST_UNAVAILABLE`, `OPENAI_ALLOWLIST_NO_MATCH`). Docs: MUI Alert docs https://llms.mui.com/material-ui/6.4.12/components/alert.md.
3. [ ] Submit canonical ingest payload fields from form. Files (read/edit): `client/src/components/ingest/IngestForm.tsx`. Constraint: send `embeddingProvider` + `embeddingModel` in request payload and preserve compatibility behavior for legacy `model` only where required by server contract. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://react.dev/reference/react-dom/components/input.
4. [ ] Clear stale selections when model list changes. Files (read/edit): `client/src/components/ingest/IngestForm.tsx`. Constraint: invalid prior selection cannot be submitted. Docs: React controlled form docs https://react.dev/reference/react-dom/components/input.
5. [ ] Keep selection identity provider-qualified end-to-end. Files (read/edit): `client/src/components/ingest/IngestForm.tsx`. Constraint: selected value, displayed label, and submitted payload must remain provider-qualified so same model ids from different providers cannot collide. Docs: https://react.dev/reference/react-dom/components/input and https://spec.openapis.org/oas/v3.0.3.html.
6. [ ] Keep ingest UI dimension-free. Files (read/edit): `client/src/components/ingest/IngestForm.tsx`, `client/src/pages/IngestPage.tsx`. Constraint: do not add dimension input fields or controls in this story. Docs: https://llms.mui.com/material-ui/6.4.12/components/text-fields.md and https://spec.openapis.org/oas/v3.0.3.html.
7. [ ] Normalize ingest status/error rendering in ActiveRunCard. Files (read/edit): `client/src/components/ingest/ActiveRunCard.tsx`. Constraint: render both legacy string `lastError` and normalized object error payloads safely. Docs: https://react.dev/reference/react and https://spec.openapis.org/oas/v3.0.3.html.
8. [ ] Normalize ingest status/error rendering in RootsTable. Files (read/edit): `client/src/components/ingest/RootsTable.tsx`. Constraint: render both legacy string `lastError` and normalized object error payloads safely. Docs: https://react.dev/reference/react and https://spec.openapis.org/oas/v3.0.3.html.
9. [ ] Normalize ingest status/error rendering in RootDetailsDrawer. Files (read/edit): `client/src/components/ingest/RootDetailsDrawer.tsx`. Constraint: render both legacy string `lastError` and normalized object error payloads safely. Docs: https://react.dev/reference/react and https://spec.openapis.org/oas/v3.0.3.html.
10. [ ] Prefer canonical lock display in IngestPage + IngestForm. Files (read/edit): `client/src/pages/IngestPage.tsx`, `client/src/components/ingest/IngestForm.tsx`. Constraint: canonical fields (`embeddingProvider`, `embeddingModel`, `embeddingDimensions`) display first; use aliases only when canonical fields are missing. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://react.dev/reference/react.
11. [ ] Prefer canonical lock display in RootsTable + RootDetailsDrawer. Files (read/edit): `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/RootDetailsDrawer.tsx`. Constraint: canonical fields (`embeddingProvider`, `embeddingModel`, `embeddingDimensions`) display first; use aliases only when canonical fields are missing. Docs: https://spec.openapis.org/oas/v3.0.3.html and https://react.dev/reference/react.
12. [ ] Keep banner style consistent with existing app conventions. Files (read/edit): `client/src/components/ingest/IngestForm.tsx`, `client/src/pages/IngestPage.tsx`, `client/src/pages/ChatPage.tsx` (reference patterns). Constraint: use MUI `Alert` with deterministic `data-testid` assertions and consistent severity styling. Docs: MUI Alert docs https://llms.mui.com/material-ui/6.4.12/components/alert.md.
13. [ ] Add UI test for provider-qualified dropdown option rendering. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert each dropdown option renders provider-qualified identity (`provider / model`) and keeps same model ids distinguishable by provider. Purpose: prevent ambiguous model selection UI. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
14. [ ] Add UI test for stale-selection clearing after model-list refresh. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert previously selected value is cleared when it is no longer present in refreshed model options. Purpose: stop invalid stale selections from being submitted. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://react.dev/reference/react-dom/components/input.
15. [ ] Add UI test for `OPENAI_DISABLED` info banner behavior. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert disabled status shows the required `OPENAI_EMBEDDING_KEY` guidance banner text. Purpose: guarantee missing-key UX contract. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://llms.mui.com/material-ui/6.4.12/components/alert.md.
16. [ ] Add UI test for `OPENAI_MODELS_LIST_TEMPORARY_FAILURE` banner behavior. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert temporary-failure warning banner shows expected copy and does not hide LM Studio options. Purpose: enforce transient-failure UX behavior. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://llms.mui.com/material-ui/6.4.12/components/alert.md.
17. [ ] Add UI test for `OPENAI_MODELS_LIST_AUTH_FAILED` banner behavior. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert auth-failed warning banner appears with deterministic status-code-driven messaging. Purpose: keep auth failure handling explicit for users. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://llms.mui.com/material-ui/6.4.12/components/alert.md.
18. [ ] Add UI test for `OPENAI_MODELS_LIST_UNAVAILABLE` banner behavior. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert unavailable warning banner appears with expected visibility and copy. Purpose: validate outage-state UX contract. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://llms.mui.com/material-ui/6.4.12/components/alert.md.
19. [ ] Add UI test for `OPENAI_ALLOWLIST_NO_MATCH` banner behavior. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert no-match warning banner appears and OpenAI options remain absent. Purpose: enforce strict allowlist UX expectations. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://llms.mui.com/material-ui/6.4.12/components/alert.md.
20. [ ] Add UI test asserting no dimensions control exists on ingest form. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert no dimensions input/select is rendered in the ingest form. Purpose: guarantee story scope excludes dimension configuration UI. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
21. [ ] Add submit-payload UI test for canonical fields. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert form submit sends `embeddingProvider` and `embeddingModel` keys with selected provider-qualified identity. Purpose: validate canonical request contract from UI layer. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://react.dev/reference/react-dom/components/input.
22. [ ] Add UI test for ActiveRunCard normalized and legacy error rendering. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestStatus.test.tsx`. Description: assert ActiveRunCard safely renders both legacy string and normalized object error payloads. Purpose: preserve backward-compatible status rendering. Files (read/edit): `client/src/test/ingestStatus.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
23. [ ] Add UI test for RootsTable normalized and legacy error rendering. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestRoots.test.tsx`. Description: assert RootsTable safely renders both legacy and normalized error payload formats. Purpose: avoid runtime rendering regressions during contract transition. Files (read/edit): `client/src/test/ingestRoots.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
24. [ ] Add UI test for RootDetailsDrawer normalized and legacy error rendering. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestRoots.test.tsx`. Description: assert drawer details safely render normalized and legacy error payloads. Purpose: keep detailed root diagnostics stable for existing and new payloads. Files (read/edit): `client/src/test/ingestRoots.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
25. [ ] Add UI test for same model-id cross-provider selection/submit ambiguity. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/ingestForm.test.tsx`. Description: assert when two options share model id across providers, selected value, displayed label, and submitted payload stay provider-qualified and unambiguous. Purpose: prevent cross-provider identity collisions in UI state and payloads. Files (read/edit): `client/src/test/ingestForm.test.tsx`. Docs: https://react.dev/reference/react-dom/components/input and https://llms.mui.com/material-ui/6.4.12/components/text-fields.md.
26. [ ] Add Chat page tool-result compatibility test for canonical+alias repo payload fields. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/chatPage.toolDetails.test.tsx`. Description: assert tool details continue rendering model identity when server payload adds canonical embedding fields alongside legacy `modelId`. Purpose: prevent chat tool-result regressions from contract migration. Files (read/edit): `client/src/test/chatPage.toolDetails.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
27. [ ] Add Agents page tool-result compatibility test for canonical+alias repo payload fields. Test type: Unit/UI (Jest + React Testing Library). Location: `client/src/test/agentsPage.toolsUi.test.tsx`. Description: assert agent tool details continue rendering model identity when server payload adds canonical embedding fields alongside legacy `modelId`. Purpose: prevent agents tool-result regressions from contract migration. Files (read/edit): `client/src/test/agentsPage.toolsUi.test.tsx`. Docs: https://jestjs.io/docs/getting-started.
28. [ ] Add ingest UI interaction logs for selection, banners, and submit payload shape. Files (read/edit): `client/src/components/ingest/IngestForm.tsx`, `client/src/pages/IngestPage.tsx`, `client/src/components/ingest/ActiveRunCard.tsx`, `client/src/components/ingest/RootsTable.tsx`, `client/src/components/ingest/RootDetailsDrawer.tsx`, and client logging helpers. Required log lines: `DEV-0000036:T13:ingest_ui_state_rendered` (expected selected provider/model and active banner status code) and `DEV-0000036:T13:ingest_ui_submit_payload` (expected payload includes `embeddingProvider` and `embeddingModel`, omits dimensions input fields). Purpose: confirm UI state and submission contracts are exercised as designed.
29. [ ] Update markdown document `projectStructure.md` for Task 13 file-map changes. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add/update tree entries for all Task 13 files that were created, removed, or renamed. Purpose: keep repository structure documentation accurate for junior developers and downstream tasks. Files (read/edit): `projectStructure.md`. Required behavior: after all Task 13 file additions/removals are complete, add/update entries for every created/removed path before marking this task done. Required `projectStructure.md` entries for this task: Added files: `None planned` (Task 13 is expected to extend existing UI/test files unless a new ingest UI helper is introduced). Removed files: `None planned`.
30. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: interact with ingest form/status UI at `http://host.docker.internal:5001`; verify browser debug logs include `DEV-0000036:T13:ingest_ui_state_rendered` and `DEV-0000036:T13:ingest_ui_submit_payload` with provider-qualified selections and canonical payload fields, then capture screenshots for provider-qualified model selection, OpenAI warning/info banner state, active run card, and roots details drawer to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped by `docker-compose.local.yml`) using names `0000036-13-provider-select.png`, `0000036-13-openai-banner.png`, `0000036-13-active-run-card.png`, and `0000036-13-root-details-drawer.png`. Expected outcome: UI logs match displayed state/submission payload, screenshots are reviewed by the agent against Task 13 GUI expectations, and browser debug console has zero errors.
9. [ ] `npm run compose:down`

10. [ ] Confirm `client/src/test/ingestForm.test.tsx` and `client/src/test/ingestPage.layout.test.tsx` pass.
11. [ ] Confirm warning/info banner behavior is covered by existing banner-pattern tests (`client/src/test/chatPage.codexBanners.test.tsx`) plus new/updated ingest-specific assertions.
12. [ ] Confirm ingest UI tests pass for same model-id cross-provider selection and the full OpenAI banner/statusCode matrix.
13. [ ] Confirm tool-result compatibility tests pass in `client/src/test/chatPage.toolDetails.test.tsx` and `client/src/test/agentsPage.toolsUi.test.tsx`.

#### Implementation notes

- Notes added during implementation.

---

### 14. Final verification: full acceptance validation, regressions, and documentation sync

- Task Status: **__to_do__**
- Git Commits:

#### Overview

Run the complete verification gate for Story 0000036, confirm acceptance criteria end-to-end, and sync project documentation with the implemented result.

#### Documentation Locations

- Docker/Compose docs: Context7 `/docker/docs` (use for clean build/startup verification commands and compose lifecycle checks).
- Playwright docs: Context7 `/microsoft/playwright` (use for end-to-end and screenshot validation guidance).
- Jest docs: Context7 `/jestjs/jest` (use for final server/client automated verification strategy).
- Cucumber guides: https://cucumber.io/docs/guides/ (use for final BDD verification mapping against acceptance criteria).
- Cucumber 10-minute tutorial: https://cucumber.io/docs/guides/10-minute-tutorial/ (use for concrete step-definition and feature authoring conventions).
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ (use for final story documentation updates and formatting consistency).
- Conventional Commits: https://www.conventionalcommits.org/en/v1.0.0/ (use for final PR summary/commit message structure references).

#### Subtasks

1. [ ] Update markdown document `planning/0000036-openai-embeddings-provider-locking.md` with the requirements traceability matrix. Document: `planning/0000036-openai-embeddings-provider-locking.md`. Location: repository planning folder (`/planning/0000036-openai-embeddings-provider-locking.md`). Description: add a concrete matrix that maps every acceptance criterion and every listed edge case to automated test paths and/or manual evidence artifacts. Purpose: ensure implementation coverage is explicit and auditable before sign-off. Files (read/edit): `planning/0000036-openai-embeddings-provider-locking.md`. Docs: https://cucumber.io/docs/guides/overview/ and https://jestjs.io/docs/getting-started.
2. [ ] Update markdown document `README.md` for implemented env/contract behavior. Document: `README.md`. Location: repository root (`/README.md`). Description: document `OPENAI_EMBEDDING_KEY`, provider-aware ingest model selection, and relevant server endpoints exactly as implemented (no aspirational text). Purpose: keep runtime and operations guidance accurate for all developers. Files (read/edit): `README.md`. Docs: https://www.markdownguide.org/basic-syntax/.
3. [ ] Update markdown document `design.md` for implemented architecture and contract behavior. Document: `design.md`. Location: repository root (`/design.md`). Description: include canonical lock fields, compatibility behavior, and provider-aware request/response flow updates with concrete endpoint names and final Mermaid diagrams. Purpose: keep architecture documentation aligned with implemented server and client behavior. Files (read/edit): `design.md`. Docs: https://spec.openapis.org/oas/v3.0.3.html.
4. [ ] Update markdown document `planning/0000036-openai-embeddings-provider-locking.md` with final implementation summary notes. Document: `planning/0000036-openai-embeddings-provider-locking.md`. Location: repository planning folder (`/planning/0000036-openai-embeddings-provider-locking.md`). Description: record final contract changes, backward-compatibility decisions, test evidence, and explicitly deferred out-of-scope items in Task 14 Implementation notes. Purpose: preserve an auditable implementation record in the story itself. Files (read/edit): `planning/0000036-openai-embeddings-provider-locking.md`. Docs: https://www.conventionalcommits.org/en/v1.0.0/ and https://www.markdownguide.org/basic-syntax/.
5. [ ] Publish final PR summary comment from the completed story notes. Files (read/edit): PR description/comment location used by the repository process (no repo file change required). Required behavior: PR summary must mirror the final story notes and traceability matrix without introducing new unverified claims. Docs: https://www.conventionalcommits.org/en/v1.0.0/.
6. [ ] Close any uncovered matrix rows before story sign-off. Files (read/edit): `planning/0000036-openai-embeddings-provider-locking.md` plus associated test files touched during implementation. Required behavior: if any acceptance/edge-case row lacks coverage, add or update the corresponding automated test and update the matrix entry before marking Task 14 done. Docs: https://jestjs.io/docs/getting-started and https://cucumber.io/docs/guides/overview/.
7. [ ] Add final verification evidence logs that aggregate acceptance completion. Files (read/edit): final verification helper/logging files used in this story (for example verification scripts or task-level runtime logging points) plus this story planning document Implementation notes. Required log lines: `DEV-0000036:T14:acceptance_matrix_verified` (expected `allRowsCovered=true`) and `DEV-0000036:T14:manual_regression_completed` (expected list of checked surfaces and `consoleErrors=0`). Purpose: create explicit completion evidence for final sign-off.
8. [ ] Update markdown document `projectStructure.md` for final story file-map updates. Document: `projectStructure.md`. Location: repository root (`/projectStructure.md`). Description: add one-line purpose entries for every file/folder created, renamed, or removed by Story 0000036. Purpose: keep repository structure documentation complete and maintainable. Files (read/edit): `projectStructure.md`. Required behavior: this subtask must be completed after subtask 6 so any test files created to close matrix gaps are included. Required `projectStructure.md` entries for this task: Added files: every new file created anywhere in Story 0000036 (including any files added while closing uncovered matrix rows in subtask 6). Removed files: every deleted/renamed file from Story 0000036 (use explicit paths; if none, write `None`). Docs: https://www.markdownguide.org/basic-syntax/.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check: execute final acceptance/regression walkthrough at `http://host.docker.internal:5001`; verify combined logs include `DEV-0000036:T14:acceptance_matrix_verified` (`allRowsCovered=true`) and `DEV-0000036:T14:manual_regression_completed` (`consoleErrors=0`), and capture screenshots for every acceptance criterion that is GUI-verifiable (including ingest provider/model selection, warning/info banners, lock metadata display, root details/error rendering, and tool-result compatibility views) to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped by `docker-compose.local.yml`) using `0000036-14-<acceptance-item>.png` naming. Expected outcome: screenshots are reviewed by the agent against Task 14 acceptance expectations, non-visual acceptance checks are confirmed via logs/API assertions as appropriate, and browser debug console has zero errors.
9. [ ] `npm run compose:down`

10. [ ] `npm run test:unit --workspace server`
11. [ ] `npm run test:integration --workspace server`
12. [ ] `npm run compose:build:clean`
13. [ ] Capture and retain all Task 14 manual verification screenshots in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped by `docker-compose.local.yml`) using naming `0000036-14-<description>.png`, and ensure the agent has checked each screenshot against the corresponding GUI acceptance item.
14. [ ] Verify traceability matrix is complete with no uncovered acceptance or edge-case rows remaining.

#### Implementation notes

- Notes added during implementation.
