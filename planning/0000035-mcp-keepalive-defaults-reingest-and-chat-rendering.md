# Story 0000035 - MCP keepalive/defaults, re-ingest MCP tools, Codex stream dedupe, and user markdown rendering

## Implementation Plan Instructions

This story follows `planning/plan_format_no_tasks.md`.

Follow `planning/plan_format_no_tasks.md` exactly for structure and intent while this story remains in discussion/scoping mode.

## Description

CodeInfo2 currently has a few related reliability and consistency gaps across MCP, chat, and agents UX.

On the MCP side, keepalive handling is duplicated across some servers and missing from others, so long-running tool calls are not handled consistently. Default chat provider/model behavior is also split across REST and MCP paths, which makes runtime behavior harder to predict unless model/provider are always explicitly supplied.

On tooling coverage, re-ingest is available via REST but not consistently exposed in the MCP surfaces where users already work, and we need a safe MCP-level re-ingest path that only allows re-ingesting repositories that are already known/ingested. The naming decision for this story is to use one canonical tool name on both MCP surfaces: `reingest_repository`.

On output correctness, after upgrading to `@openai/codex-sdk@0.101.0` (with `gpt-5.3-codex` usage), assistant output can appear cropped and duplicated in the web GUI around tool-call boundaries. This creates direct trust issues because final visible answers can be wrong even when the model execution was otherwise successful. The decision for this story is to keep existing bubble formatting and presentation behavior as-is, and only correct text assembly so content is complete and not duplicated.

On chat/agents UX, user-authored text formatting is not rendered in user bubbles even though assistant text is markdown-rendered. Current send logic trims leading/trailing whitespace before sending to AI in both chat and agents paths, while interior whitespace/newlines are preserved. This story now fixes that policy to preserve full raw user input end-to-end with no trimming.

The target end state for this story is consistent MCP keepalive behavior, unified default provider/model resolution across REST and MCP, controlled MCP re-ingest support on both relevant MCP surfaces, corrected Codex stream assembly to prevent cropped/duplicate text, and user bubble markdown rendering that preserves intended formatting in both Chat and Agents pages. The defaulting decision for this story is explicit: only `CHAT_DEFAULT_PROVIDER` and `CHAT_DEFAULT_MODEL` are used as overrides, and when those env vars are absent the system defaults to provider `codex` and model `gpt-5.3-codex` for both REST chat and MCP `codebase_question`. Committed `.env` files are updated as part of this story to set those same values.

Provider availability fallback behavior for this story is explicit: if the selected/default provider is unavailable at runtime, the system should automatically fall back to the other provider when that other provider is available (`codex -> lmstudio`, `lmstudio -> codex`). If neither provider is available, keep the selected/default provider and surface the existing unavailable state/error behavior.

For MCP re-ingest safety, this story uses strict exact-match validation against known ingested roots. Input must be a `sourceId` string representing an already ingested repository root, normalized to POSIX form before matching. Re-ingest must reject unknown/non-string/empty/non-absolute `sourceId` values and must not perform any first-time ingest behavior.

For markdown parity, user bubbles will use the exact same renderer and sanitization profile as assistant bubbles (`client/src/components/Markdown.tsx`). Current assistant markdown support (to be matched exactly for users) is:
- GFM markdown via `remark-gfm` (including common GFM syntax such as lists and fenced code blocks; tables/checkbox/task-list/strikethrough/autolinks are handled by the same plugin path).
- Sanitized HTML via `rehype-sanitize` using a schema derived from `defaultSchema` (with controlled `className` allowances on `code`/`span`/`pre`).
- Mermaid fenced code blocks (language `mermaid`) rendered as diagrams, with script tags stripped before render.
- Standard markdown elements already styled in the component (`p`, `ul/ol/li`, `code/pre`, `blockquote`, `table`, `img`, `a`).

### Story Output Summary (Junior-Friendly)

At story completion, a junior developer should be able to verify these outcomes directly:
- All MCP servers use one shared keepalive implementation with identical lifecycle behavior.
- REST chat and MCP `codebase_question` choose provider/model from the same precedence rules, with the same fallback defaults and runtime provider auto-fallback behavior.
- `reingest_repository` exists on both MCP surfaces with one identical request/response/error contract and strict existing-root-only safety.
- Codex responses in the UI no longer show cropped starts or duplicated final answer text when tool calls occur during streaming.
- User message bubbles in Chat and Agents render with the same markdown/sanitization behavior as assistant bubbles, and valid non-whitespace user input is sent raw (no trimming).

### Verified Current Behavior (Baseline)

- Keepalive timer logic is currently duplicated in `server/src/mcp2/router.ts` and `server/src/mcpAgents/router.ts`, while `server/src/mcp/server.ts` currently has no keepalive writes for long-running calls.
- REST chat currently requires both `model` and non-empty `message` (`trim().length > 0`) and defaults provider to `lmstudio` when omitted (`server/src/routes/chatValidators.ts`).
- MCP `codebase_question` currently defaults provider to `codex` and codex model to `gpt-5.1-codex-max` when omitted (`server/src/mcp2/tools/codebaseQuestion.ts`).
- Chat/Agents client send paths currently trim user input before sending (`client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/hooks/useChatStream.ts`), so leading/trailing whitespace is dropped before request dispatch.
- Chat/Agents user bubbles currently render text with `<Typography data-testid="user-text">` while assistant bubbles use `client/src/components/Markdown.tsx`, which causes formatting parity gaps for user text.

### Research Findings (2026-02-22)

- MCP tools guidance distinguishes protocol errors (JSON-RPC `error`) from tool execution errors (`result.isError=true`), and recommends execution failures be surfaced as tool results so LLM callers can self-correct.
  - Source: https://modelcontextprotocol.io/specification/draft/server/tools
- JSON-RPC 2.0 allows application-defined error codes outside reserved ranges; only `-32768..-32000` is reserved.
  - Source: https://www.jsonrpc.org/specification
- JSON text grammar allows surrounding whitespace (`JSON-text = ws value ws`), which means whitespace heartbeat bytes do not invalidate the final JSON payload when parsers are standards-compliant.
  - Source: https://www.rfc-editor.org/rfc/rfc8259
- OpenAI Codex App Server lifecycle is item-based (`item/started`, optional deltas, `item/completed` terminal payload), so completed item state should be treated as authoritative final state for merge correctness.
  - Sources:
    - https://openai.com/index/unlocking-the-codex-harness/
    - https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md

## Acceptance Criteria

- Keepalive logic is centralized in one shared helper under `server/src/mcpCommon/` and is used by all three MCP surfaces: `server/src/mcp/server.ts`, `server/src/mcp2/router.ts`, and `server/src/mcpAgents/router.ts`.
- For long-running MCP `tools/call`, keepalive starts before tool dispatch and always stops on success, error, socket close, and response end; all three surfaces use the same heartbeat interval and initial-flush behavior.
- Keepalive heartbeat bytes are JSON-whitespace-only, and final responses remain valid JSON-RPC payloads parseable by standards-compliant clients.
- Shared default env keys are exactly `CHAT_DEFAULT_PROVIDER` and `CHAT_DEFAULT_MODEL`; no provider-specific override keys are introduced in this story.
- Provider/model resolution order is identical for REST chat (`POST /chat`) and MCP `codebase_question`: explicit request value -> env override value -> hardcoded fallback (`provider=codex`, `model=gpt-5.3-codex`).
- Committed defaults are present in both `server/.env` and `server/.env.e2e` with `CHAT_DEFAULT_PROVIDER=codex` and `CHAT_DEFAULT_MODEL=gpt-5.3-codex`.
- Runtime provider availability fallback is deterministic for chat UI defaults, REST chat execution, and MCP `codebase_question` execution: selected/default provider unavailable -> switch to the other provider only if that provider is available.
- Provider auto-fallback model rule is deterministic: select the fallback provider's first available/runtime-default model; if no fallback model is available, treat fallback as unavailable and keep the originally selected/default provider.
- Auto-fallback is single-hop per request (no oscillation), and the resolved provider/model for that request are what get persisted on the created/updated conversation metadata.
- Re-ingest is exposed on both MCP surfaces (`POST /mcp` and MCP v2 JSON-RPC on `MCP_PORT`) using one canonical tool name: `reingest_repository`.
- `reingest_repository` request contract is `{"sourceId":"<containerPath>"}` and success payload is `{"status":"started","runId":"...","sourceId":"...","operation":"reembed"}` wrapped in each surface's existing MCP response envelope.
- `reingest_repository` uses one cross-surface error contract: invalid params -> `error.code=-32602`, `error.message="INVALID_PARAMS"`; unknown root -> `error.code=404`, `error.message="NOT_FOUND"`; ingest busy -> `error.code=429`, `error.message="BUSY"`.
- `reingest_repository` error behavior is a deliberate compatibility lock for this story: keep the established JSON-RPC error envelope above (do not switch to `result.isError` in this story), and document this deviation from MCP tool execution guidance.
- `sourceId` validation is strict and field-level: reject missing, non-string, empty, non-absolute, non-normalized, unknown, and ambiguous values; return AI-retry guidance with `reingestableRepositoryIds` and `reingestableSourceIds`.
- Re-ingest safety is strict: only existing ingested roots are allowed; no first-time ingest behavior is reachable from MCP `reingest_repository`.
- Codex stream assembly no longer produces cropped starts or duplicate final text for tool-interleaved responses; final assistant bubble text equals the final completed assistant message exactly once.
- Codex stream merge invariants are explicit and tested: aggregate assistant text by item identity, append deltas in sequence order, and on completed-item events treat completed text as authoritative final content for that item.
- Existing bubble visual presentation remains unchanged (layout, colors, status chips, metadata placement); this story changes content correctness and user-markdown rendering only.
- User bubbles in both Chat and Agents render through the same markdown component (`client/src/components/Markdown.tsx`) and therefore use the same sanitization and feature support as assistant bubbles, including mermaid fenced blocks.
- User input sent to providers is preserved as raw text with no trimming, including leading/trailing spaces and newlines, for both Chat and Agents flows.
- Whitespace-only/newline-only user input is rejected server-side before provider execution with explicit HTTP 400 validation errors (`POST /chat` and `POST /agents/:agentName/run`) as defined in this document.
- Regression planning is intentionally non-tasked in this document, but required coverage families are fixed now: Cucumber for server contract flows, Jest for unit/integration behavior, and e2e for user-visible stream/render outcomes.
- Unrelated public contracts stay unchanged; only contract changes explicitly documented in this story are allowed.

## Out Of Scope

- Introducing brand-new ingest/start capabilities in MCP beyond re-ingest of existing repositories.
- Redesigning the broader chat/agents page layouts beyond user message rendering behavior.
- Reworking unrelated MCP tools or adding new MCP surfaces.
- Changing conversation persistence architecture or Mongo/Chroma schemas unless required to satisfy this story.
- General model-quality tuning unrelated to the concrete duplicate/cropped stream assembly bug.
- Changing agent execution/provider-selection architecture (agents remain Codex-driven and continue using existing agent config/default model behavior outside this story's input/rendering fixes).

## Questions

None currently. Scope-defining questions for this story are resolved; if any new unknown appears during implementation, it must be added here and resolved before tasking begins.

## Scope Locks (Authoritative)

- Only `CHAT_DEFAULT_PROVIDER` and `CHAT_DEFAULT_MODEL` are in-scope for shared chat defaults. No provider-specific default env vars are in scope for this story.
- Shared default resolution order for REST chat and MCP `codebase_question` is:
  - explicit request `provider`/`model`
  - env overrides (`CHAT_DEFAULT_PROVIDER`, `CHAT_DEFAULT_MODEL`) when present
  - hardcoded fallback (`provider=codex`, `model=gpt-5.3-codex`)
- Runtime provider-availability fallback is required on both UI and server selection paths:
  - if selected/default provider unavailable and the other provider is available, auto-switch to the other provider
  - if both unavailable, keep selected/default provider and show existing unavailable behavior
  - when auto-switching providers, select the fallback provider's first available/runtime-default model (deterministic across REST chat, MCP `codebase_question`, and chat UI defaults)
  - if the fallback provider has no available model to select, treat fallback as unavailable and keep the original selected/default provider
  - fallback is single-hop per request and persisted for that request (no provider oscillation)
- Raw-input policy is end-to-end:
  - preserve user input exactly as entered (including leading/trailing spaces/newlines) when sending to provider
  - reject whitespace-only/newline-only messages before any provider call
- User bubble markdown policy is strict parity:
  - same renderer component (`client/src/components/Markdown.tsx`)
  - same sanitization profile
  - same feature set (including mermaid handling)
- Codex stream bug fix must preserve current visual layout/status behavior; this story only changes text correctness (no cropped starts, no duplicated final content).

## Message Contracts & Storage Shapes

This section is authoritative for contracts/shapes in this story and is aligned with current code plus external MCP guidance verification.

Contract decision summary:
- New contract introduced in this story:
  - MCP tool `reingest_repository` on both MCP surfaces.
- Existing contracts changed in this story:
  - Non-empty input validation message text for `POST /chat` and `POST /agents/:agentName/run` to enforce whitespace-only rejection while preserving raw input for valid requests.
- Existing contracts explicitly reused unchanged:
  - REST `/chat` envelope style (`{ status, code, message }`), Agents REST envelope style (`{ error, ... }`), classic `/mcp` and MCP v2 JSON-RPC wrappers, `/ingest/reembed/:root` baseline `runId/BUSY/NOT_FOUND` semantics, ingest repo listing payloads.
- Storage schema migration requirement:
  - None. No new Mongo collections/fields are required.

### Reused Existing Contracts (No Envelope Unification In This Story)

- REST `POST /chat` keeps existing error envelope shape:
  - HTTP `400` with `{ "status": "error", "code": "VALIDATION_FAILED", "message": "..." }`.
- REST `POST /agents/:agentName/run` keeps existing error envelope shape:
  - HTTP `400` with `{ "error": "invalid_request", "message": "..." }`.
- Classic MCP (`POST /mcp`) and MCP v2 (`tools/call` JSON-RPC) keep existing success wrapper shape:
  - `{ "jsonrpc":"2.0","id":...,"result":{"content":[{"type":"text","text":"<json-string>"}]}}`
- Existing mismatch between classic and MCP v2 unknown-tool behavior is intentionally untouched in this story.
- Existing `/ingest/reembed/:root` REST semantics are reused as the source contract for `reingest_repository` outcomes:
  - success -> `runId`
  - busy -> `BUSY`
  - unknown -> `NOT_FOUND`
- Existing REST start-run behavior for chat/agents remains unchanged in this story:
  - `POST /chat` stays asynchronous with HTTP `202` start response + WS transcript events.
  - `POST /agents/:agentName/run` stays HTTP `202` with the existing started payload shape.

### New MCP Tool Contract In This Story

Canonical MCP tool name on both MCP surfaces:
- `reingest_repository`

Canonical request payload (inside MCP `tools/call` arguments):
```json
{
  "sourceId": "/data/my-repo"
}
```

Canonical success payload (inside each surface's existing MCP content wrapper):
```json
{
  "status": "started",
  "operation": "reembed",
  "runId": "ingest-1730000000000",
  "sourceId": "/data/my-repo"
}
```

Canonical `reingest_repository` error mapping:
- Invalid params:
  - `error.code`: `-32602`
  - `error.message`: `"INVALID_PARAMS"`
  - Used for malformed or invalid `sourceId` (missing, non-string, empty, non-absolute, non-normalized, ambiguous format).
- Unknown root:
  - `error.code`: `404`
  - `error.message`: `"NOT_FOUND"`
  - Used when `sourceId` is syntactically valid but does not exactly match a known ingested root after normalization.
- Busy:
  - `error.code`: `429`
  - `error.message`: `"BUSY"`
  - Used when ingest/reembed lock is currently held and the operation cannot start.

Compatibility lock:
- MCP guidance recommends tool-execution failures as `result.isError=true`.
- This story intentionally keeps JSON-RPC `error` envelopes for `reingest_repository` failures to match existing server behavior and avoid breaking current MCP clients in this repository.

Canonical `error.data` for `sourceId` validation failures (AI-retry friendly, field-level):
```json
{
  "tool": "reingest_repository",
  "code": "INVALID_SOURCE_ID",
  "retryable": true,
  "retryMessage": "The AI can retry using one of the provided re-ingestable repository ids/sourceIds.",
  "fieldErrors": [
    {
      "field": "sourceId",
      "reason": "non_absolute",
      "message": "sourceId must be an absolute normalized container path"
    }
  ],
  "reingestableRepositoryIds": [
    "repo-id-1",
    "repo-id-2"
  ],
  "reingestableSourceIds": [
    "/data/repo-1",
    "/data/repo-2"
  ]
}
```

Canonical `error.data` for unknown root (`NOT_FOUND`) and busy (`BUSY`):
```json
{
  "tool": "reingest_repository",
  "code": "NOT_FOUND",
  "retryable": true,
  "retryMessage": "The AI can retry using one of the provided re-ingestable repository ids/sourceIds.",
  "fieldErrors": [
    {
      "field": "sourceId",
      "reason": "unknown_root",
      "message": "sourceId is not in the current ingested-root set"
    }
  ],
  "reingestableRepositoryIds": [
    "repo-id-1",
    "repo-id-2"
  ],
  "reingestableSourceIds": [
    "/data/repo-1",
    "/data/repo-2"
  ]
}
```

```json
{
  "tool": "reingest_repository",
  "code": "BUSY",
  "retryable": true,
  "retryAfterMs": 3000
}
```

### Existing Contracts Changed In This Story

Canonical non-empty input rejection contracts (raw input still preserved when valid):

`POST /chat` (REST chat):
```json
{
  "status": "error",
  "code": "VALIDATION_FAILED",
  "message": "message must contain at least one non-whitespace character"
}
```

`POST /agents/:agentName/run` (Agents REST):
```json
{
  "error": "invalid_request",
  "message": "instruction must contain at least one non-whitespace character"
}
```

Notes:
- These contracts apply only to whitespace-only/newline-only inputs.
- Both contracts return HTTP status `400`.
- Conversation title trimming (`slice(0, 80)`) may continue for metadata/title generation and is not treated as message-content trimming.

### Storage Shapes (No Schema Changes)

Repository/source listing shape used to build retry options (existing contract, reused):
```json
{
  "id": "repo-id",
  "description": "optional description",
  "containerPath": "/data/my-repo",
  "hostPath": "/Users/me/dev/my-repo",
  "hostPathWarning": "optional warning",
  "lastIngestAt": "2026-02-22T10:00:00.000Z",
  "modelId": "text-embedding-model",
  "counts": { "files": 123, "chunks": 456, "embedded": 456 },
  "lastError": null
}
```

Ingest-root metadata (existing storage, reused):
- Keys include `root`, `name`, `description`, `model`, `state`, `lastIngestAt`, `ingestedAtMs`, counts, and optional AST counters/timestamps.
- Re-ingest selection remains strict root-based (`meta.root === sourceId` after normalization) and uses latest matching snapshot by timestamp/run ordering.

Conversation/Turn Mongo shapes (existing storage, reused):
- Conversation keeps `_id`, `provider`, `model`, `title`, optional `agentName`/`flowName`, `source`, `flags`, `lastMessageAt`, `archivedAt`, timestamps.
- Turn keeps `conversationId`, `role`, raw `content`, `model`, `provider`, `toolCalls`, `status`, `source`, optional `command`, optional `usage`, optional `timing`, `createdAt`.
- Raw-input preservation and provider fallback behavior are behavioral changes only; no schema extension/migration is required.

## Implementation Ideas

This section is a rough implementation sequence only (non-tasked), validated against current code and external docs (`code_info`, `deepwiki`, `context7`).

### Phase 1: Shared Chat Defaults + Runtime Fallback Core

- Create one shared resolver in `server/src/config/chatDefaults.ts` for provider/model resolution:
  - explicit request values -> env (`CHAT_DEFAULT_PROVIDER`, `CHAT_DEFAULT_MODEL`) -> hardcoded fallback (`codex`, `gpt-5.3-codex`).
  - single-hop runtime provider fallback when selected/default provider unavailable.
  - fallback model selection uses fallback provider's first available/runtime-default model.
- Apply resolver consistently across:
  - REST path: `server/src/routes/chatValidators.ts` and execution flow in `server/src/routes/chat.ts`.
  - MCP path: `server/src/mcp2/tools/codebaseQuestion.ts`.
  - UI default sources: `server/src/routes/chatProviders.ts`, `server/src/routes/chatModels.ts`, and client selection behavior in `client/src/hooks/useChatModel.ts`.
- Ensure resolved provider/model are persisted per request path where conversations are created/updated.
- Update committed defaults in:
  - `server/.env`
  - `server/.env.e2e`

### Phase 2: MCP Keepalive Unification

- Introduce one shared keepalive helper in `server/src/mcpCommon/` (timer lifecycle + safe send wrapper + teardown hooks).
- Replace duplicated/local implementations in:
  - `server/src/mcp2/router.ts`
  - `server/src/mcpAgents/router.ts`
- Apply same helper to the classic MCP router in `server/src/mcp/server.ts` for long-running `/mcp` tool calls.
- Keep heartbeat writes JSON-whitespace-only and ensure clean stop on success, error, abort/close, and response end.

### Phase 3: Shared `reingest_repository` Service + Dual-Surface MCP Wiring

- Create a shared server-side service (under `server/src/ingest/` or `server/src/mcpCommon/`) that:
  - validates `sourceId` via strict normalized absolute path checks.
  - verifies exact match against current ingested roots list (`listIngestedRepositories` + roots metadata).
  - triggers existing re-embed pipeline (`reembed`) only.
- Wire canonical MCP tool `reingest_repository` into both MCP surfaces:
  - classic MCP in `server/src/mcp/server.ts`
  - MCP v2 registry/handler in `server/src/mcp2/tools.ts` (and dedicated module under `server/src/mcp2/tools/`).
- Preserve the documented compatibility contract:
  - success payload fields: `status`, `operation`, `runId`, `sourceId`
  - errors: `-32602/INVALID_PARAMS`, `404/NOT_FOUND`, `429/BUSY`
  - `error.data` includes field-level failures and retryable repo/source lists for AI retry.

### Phase 4: Codex Stream Merge Correctness (Duplicate/Cropped Fix)

- Update Codex aggregation to item-keyed merge behavior in:
  - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
  - plus bridge/inflight merge boundaries in `server/src/chat/chatStreamBridge.ts` and `server/src/chat/inflightRegistry.ts` as needed.
- Merge rules:
  - append ordered deltas by item identity.
  - do not treat non-prefix snapshots as append text.
  - treat completed-item state as authoritative final content for that item.
  - prevent any second append of final text after completion.
- Keep current bubble UI presentation unchanged; this phase is content correctness only.

### Phase 5: User Markdown Parity + Raw Input Preservation

- Chat/Agents send paths:
  - remove `trim()`-based payload mutation before send in `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/hooks/useChatStream.ts`.
  - preserve raw user text (including leading/trailing whitespace and newlines) end-to-end.
- Server validation:
  - keep server-authoritative rejection for whitespace-only/newline-only messages in `server/src/routes/chatValidators.ts` and `server/src/routes/agentsRun.ts`.
  - preserve non-whitespace raw content exactly when forwarding to providers.
- Rendering:
  - replace user `<Typography data-testid="user-text">` rendering path with shared `client/src/components/Markdown.tsx` in both Chat and Agents pages.
  - keep same sanitization and feature profile as assistant messages (including mermaid handling).

### Phase 6: Regression Surfaces (Still Non-Tasked)

- Server tests:
  - keepalive helper lifecycle behavior across all MCP surfaces.
  - shared defaults/fallback determinism for REST + MCP.
  - `reingest_repository` contracts and strict `sourceId` validation branches.
  - Codex stream interleaving scenario reproducing prior duplicate/cropped symptom.
- Client tests:
  - raw-input preservation payload assertions for Chat and Agents.
  - user markdown parity rendering and sanitization behavior.
- End-to-end:
  - one representative chat flow validating no duplicate/cropped final output.
  - one representative agents/chat markdown user bubble parity validation.
