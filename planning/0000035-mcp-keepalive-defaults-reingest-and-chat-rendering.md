# Story 0000035 - MCP keepalive/defaults, re-ingest MCP tools, Codex stream dedupe, and user markdown rendering

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo's planning style):

- Each task's **Documentation Locations** section contains external references only (website docs, Context7 library docs, Deepwiki MCP docs where needed).
- Repo file paths to read/edit are listed only inside **Subtasks**.

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
- MCP v2 router currently applies a Codex-availability gate at `tools/list` and `tools/call`, which can block `codebase_question` execution before provider-specific fallback logic is evaluated (`server/src/mcp2/router.ts`).
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
- MCP v2 `tools/list` and `tools/call` are not globally blocked by Codex availability; provider selection/fallback is evaluated in `codebase_question` execution flow so LM Studio fallback remains reachable.
- Provider-unavailable terminal behavior is explicit and stable when neither provider can run:
  - REST `POST /chat` -> HTTP `503` with existing `{ status: "error", code: "PROVIDER_UNAVAILABLE", message }` envelope.
  - MCP `codebase_question` -> JSON-RPC `error` with existing `code=-32001` and `message="CODE_INFO_LLM_UNAVAILABLE"`.
- Re-ingest is exposed on both MCP surfaces (`POST /mcp` and MCP v2 JSON-RPC on `MCP_PORT`) using one canonical tool name: `reingest_repository`.
- `reingest_repository` request contract is `{"sourceId":"<containerPath>"}` and success payload is `{"status":"started","runId":"...","sourceId":"...","operation":"reembed"}` wrapped in each surface's existing MCP response envelope.
- `reingest_repository` uses one cross-surface error contract: invalid params -> `error.code=-32602`, `error.message="INVALID_PARAMS"`; unknown root -> `error.code=404`, `error.message="NOT_FOUND"`; ingest busy -> `error.code=429`, `error.message="BUSY"`.
- `reingest_repository` error behavior is a deliberate compatibility lock for this story: keep the established JSON-RPC error envelope above (do not switch to `result.isError` in this story), and document this deviation from MCP tool execution guidance.
- `sourceId` validation is strict and field-level: reject missing, non-string, empty, non-absolute, non-normalized, unknown, and ambiguous values; return AI-retry guidance with `reingestableRepositoryIds` and `reingestableSourceIds`.
- Re-ingest safety is strict: only existing ingested roots are allowed; no first-time ingest behavior is reachable from MCP `reingest_repository`.
- Codex stream assembly no longer produces cropped starts or duplicate final text for tool-interleaved responses; final assistant bubble text equals the final completed assistant message exactly once.
- Codex stream merge invariants are explicit and tested: aggregate assistant text by item identity, append deltas in sequence order, and on completed-item events treat completed text as authoritative final content for that item.
- Bubble container/chrome presentation remains unchanged (layout, colors, status chips, metadata placement); this story changes text correctness and user-bubble markdown rendering behavior only.
- User bubbles in both Chat and Agents render through the same markdown component (`client/src/components/Markdown.tsx`) and therefore use the same sanitization and feature support as assistant bubbles, including mermaid fenced blocks.
- User input sent to providers is preserved as raw text with no trimming, including leading/trailing spaces and newlines, for both Chat and Agents flows.
- Whitespace-only/newline-only user input is rejected server-side before provider execution with explicit HTTP 400 validation errors (`POST /chat` and `POST /agents/:agentName/run`) as defined in this document.
- Required regression coverage families are fixed: Cucumber for server contract flows, Jest for unit/integration behavior, and e2e for user-visible stream/render outcomes.
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
  - Provider/model default resolution for REST `POST /chat` and MCP `codebase_question` is unified to explicit request value -> env override -> hardcoded fallback, with runtime provider availability fallback.
  - MCP v2 availability behavior for `codebase_question` is provider-aware (no global Codex gate on `tools/list`/`tools/call`).
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

Provider/model defaulting contract (REST + MCP `codebase_question`):
- Request-level `provider` and `model` remain accepted when explicitly supplied.
- When either value is omitted, resolution order is:
  - explicit request value
  - env override (`CHAT_DEFAULT_PROVIDER`, `CHAT_DEFAULT_MODEL`)
  - hardcoded fallback (`provider=codex`, `model=gpt-5.3-codex`)
- Runtime provider unavailability applies single-hop fallback (`codex -> lmstudio` or `lmstudio -> codex`) when the other provider is available.
- Fallback model selection uses the fallback provider's first available/runtime-default model.
- If no fallback provider/model is available, keep the originally selected/default provider and surface existing unavailable behavior.
- MCP v2 availability gating is provider-aware for this story:
  - `tools/list` remains available regardless of Codex presence.
  - `tools/call` for `codebase_question` is not pre-blocked by router-level Codex checks.
  - terminal unavailable behavior remains existing per-surface contract (`PROVIDER_UNAVAILABLE` for REST, `CODE_INFO_LLM_UNAVAILABLE` for MCP) when neither provider can run.

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

## Edge Cases and Failure Modes

This section is implementation-authoritative for failure handling in this story. It is intentionally explicit so implementation and testing can assert deterministic behavior.

### MCP Keepalive Unification

- Timer lifecycle leak: keepalive interval must always be cleared on success, error, response end, and socket close for all three MCP surfaces.
- Write-after-close risk: keepalive writes after `res.end()` or closed socket must be no-op and must not throw uncaught exceptions.
- Mixed response corruption risk: keepalive must emit JSON-whitespace-only heartbeat bytes so final JSON-RPC payloads remain parseable.
- Incorrect scope risk: keepalive must only wrap long-running `tools/call` execution and must not alter parse-error/invalid-request/unknown-tool response paths.
- Contract drift risk: unknown-tool and parse-error mappings that already differ across MCP surfaces must remain unchanged unless explicitly re-scoped by a later story.

### Shared Defaults and Runtime Provider Fallback

- Split resolver risk: REST and MCP must call one shared provider/model resolver so defaults cannot diverge again.
- Partial env override risk: if either `CHAT_DEFAULT_PROVIDER` or `CHAT_DEFAULT_MODEL` is missing, unresolved fields must continue to hardcoded fallback (`codex`, `gpt-5.3-codex`) with no mixed invalid state.
- Invalid env value risk: unrecognized provider or empty model from env must be treated as unresolved and flow to hardcoded fallback.
- Runtime drift risk: provider availability can change between model-list fetch and request execution; selection must re-check availability at execution time.
- Fallback dead-end risk: if fallback provider is available but has no selectable model, treat fallback as unavailable and keep original provider/unavailable behavior.
- Oscillation risk: fallback must be single-hop per request and must not flip providers multiple times inside one request lifecycle.
- Router pre-block risk: MCP v2 `tools/list` and `tools/call` must not be globally blocked by Codex-only availability checks, or LM Studio fallback becomes unreachable.

### `reingest_repository` on Both MCP Surfaces

- Path-identity mismatch risk: `sourceId` must be normalized to POSIX absolute form before exact-match comparison to known ingested roots.
- Ambiguous input risk: reject non-string, empty, relative, host-path, non-normalized, or ambiguous `sourceId` with `-32602/INVALID_PARAMS` and field-level `error.data`.
- Unknown-root retryability risk: `NOT_FOUND` responses must include retry guidance plus `reingestableRepositoryIds` and `reingestableSourceIds` so AI callers can retry safely.
- Busy-state race risk: if ingest lock is acquired after validation but before execution, return canonical `429/BUSY` contract instead of generic failure.
- First-time-ingest safety risk: MCP `reingest_repository` must never call new-ingest flow even if candidate path exists on disk.
- Cross-surface parity risk: classic MCP and MCP v2 must expose the same tool name, argument shape, success shape, and error code/message mapping.

### Codex Stream Merge Correctness

- Non-monotonic update risk: intermediate snapshots/deltas may not be strict prefix extensions; merge logic must not assume prefix-only append.
- Item-boundary risk: tool interleaving can produce multiple item streams; aggregation must key by item identity to avoid cross-item text contamination.
- Late-delta risk: deltas received after `item/completed` for an item must not mutate finalized text for that item.
- Double-finalization risk: `turn_final`/completed publication must happen once per turn so final assistant text is not appended twice.
- Stale-event risk: events from prior inflight runs must be ignored and must not alter the current run's visible transcript.
- Interrupt/error completion risk: cancelled/failed turns must not emit a duplicated assistant final bubble; terminal error signaling must remain explicit.

### User Markdown Parity and Raw Input Preservation

- Client trim mutation risk: chat/agents client send paths must not trim or normalize valid user payload text before send.
- Empty-content guard risk: whitespace-only/newline-only input must be rejected server-side with existing HTTP 400 envelope styles before provider execution.
- Renderer parity drift risk: user bubbles must use exactly the same markdown component and sanitization profile as assistant bubbles.
- Markdown safety regression risk: enabling user markdown must not bypass current sanitize behavior (including script stripping around mermaid rendering).
- Mermaid failure UX risk: mermaid parse/render failures in user bubbles must keep the same fallback behavior used for assistant bubbles.
- Large-input stability risk: very large raw user markdown must follow existing payload/transport limits and must fail with existing request-size/validation behavior rather than partial send.

## Implementation Ideas

This section is a rough pre-tasking implementation sequence, validated against current code and external docs (`code_info`, `deepwiki`, `context7`).

### Phase 1: Shared Chat Defaults + Runtime Fallback Core

- Create one shared resolver in `server/src/config/chatDefaults.ts` for provider/model resolution:
  - explicit request values -> env (`CHAT_DEFAULT_PROVIDER`, `CHAT_DEFAULT_MODEL`) -> hardcoded fallback (`codex`, `gpt-5.3-codex`).
  - single-hop runtime provider fallback when selected/default provider unavailable.
  - fallback model selection uses fallback provider's first available/runtime-default model.
- Apply resolver consistently across:
  - REST path: `server/src/routes/chatValidators.ts` and execution flow in `server/src/routes/chat.ts`.
  - MCP path: `server/src/mcp2/tools/codebaseQuestion.ts`.
  - MCP v2 router gate path: `server/src/mcp2/router.ts` (remove global Codex-only gate for `tools/list`/`tools/call` so provider fallback can execute).
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

### Phase 6: Regression Surfaces (Pre-Tasking Notes)

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

# Implementation Plan

## Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks.
This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit and push that change, and only then begin implementation.
4. For each subtask, read the listed docs first, then complete implementation, then run the listed targeted tests before moving on.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, move to the Testing section and execute each testing item in order.
7. Once a testing item is complete, mark its checkbox.
8. After tests pass, perform each documentation update listed for the task.
9. Once a document update is complete, mark its checkbox.
10. Record detailed implementation notes and git hashes before setting Task Status to `Done`, then push.
11. Repeat for the next task in sequence.

---

## Tasks

### 1. Server: Shared default resolver for REST chat + committed env defaults

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Create one authoritative provider/model default resolver and wire it into REST chat so request defaults follow the locked precedence rules. This task also updates committed server env defaults to `codex` + `gpt-5.3-codex`.

#### Documentation Locations

- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html
- Node.js environment variables: https://nodejs.org/api/environment_variables.html
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing defaulting behavior and current fallbacks.
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
     - `server/.env`
     - `server/.env.e2e`
2. [ ] Create shared resolver module for provider/model defaults.
   - Files to edit:
     - `server/src/config/chatDefaults.ts` (new file)
   - Implementation requirements:
     - Expose deterministic resolution: explicit request -> env override -> hardcoded fallback.
     - Hardcoded fallback must be exactly `provider=codex`, `model=gpt-5.3-codex`.
     - Validate unknown/empty env values as unresolved so fallback still applies.
3. [ ] Integrate resolver into REST chat validation/execution path.
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/chat.ts`
   - Implementation requirements:
     - Keep existing REST envelopes unchanged.
     - Persist resolved provider/model on created/updated conversation metadata.
4. [ ] Update committed env defaults.
   - Files to edit:
     - `server/.env`
     - `server/.env.e2e`
   - Required values:
     - `CHAT_DEFAULT_PROVIDER=codex`
     - `CHAT_DEFAULT_MODEL=gpt-5.3-codex`
5. [ ] Add server unit tests for shared resolver precedence and REST default application.
   - Files to add/edit:
     - `server/src/test/unit/config.chatDefaults.test.ts` (new test file)
     - `server/src/test/unit/chatValidators.test.ts` (or nearest existing validator test file)
   - Cases:
     - explicit values win
     - env values applied when explicit missing
     - hardcoded fallback used when env missing/invalid
6. [ ] Update documentation for shared defaults behavior.
   - Files to edit:
     - `design.md`
     - `README.md`
7. [ ] Update `projectStructure.md` if files were added/removed.
8. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- config.chatDefaults`
6. [ ] `npm run test --workspace server -- chatValidators`
7. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 2. Server: Runtime provider availability auto-fallback across REST + MCP selection paths

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Implement runtime provider availability fallback (`codex <-> lmstudio`) with single-hop behavior and fallback-model selection rules, and ensure the same selection logic drives REST execution, MCP `codebase_question`, and chat UI default model/provider selection endpoints.

#### Documentation Locations

- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
- MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html
- Cucumber guides: https://cucumber.io/docs/guides/
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review provider availability sources and current fallback behavior.
   - Files to read:
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/mcp2/router.ts`
2. [ ] Extend shared resolver/runtime selection logic with single-hop auto-fallback.
   - Files to edit:
     - `server/src/config/chatDefaults.ts`
     - `server/src/routes/chat.ts`
   - Required behavior:
     - If selected/default provider unavailable and other provider available, switch once.
     - Select fallback provider first available/runtime-default model.
     - If no fallback model/provider available, keep original provider and return existing unavailable behavior.
3. [ ] Apply shared default resolution order and runtime fallback behavior to MCP `codebase_question`.
   - Files to edit:
     - `server/src/mcp2/tools/codebaseQuestion.ts`
4. [ ] Apply the same deterministic availability-fallback/default-selection behavior to chat UI default sources.
   - Files to edit:
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
5. [ ] Ensure resolved provider/model persistence is correct for existing conversations when fallback switches provider.
   - Files to edit:
     - `server/src/mongo/repo.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
   - Required behavior:
     - metadata update helpers can persist `provider` as well as `model`
     - REST `/chat` updates existing conversation provider/model to the resolved execution provider/model
     - MCP `codebase_question` updates existing conversation provider/model to the resolved execution provider/model
6. [ ] Remove global Codex-only router pre-blocking that prevents provider-aware fallback for `codebase_question`.
   - Files to edit:
     - `server/src/mcp2/router.ts`
   - Constraint:
     - Keep existing terminal unavailable envelopes/codes unchanged.
7. [ ] Add tests for runtime fallback determinism, persistence, UI default selection, and terminal unavailable contracts.
   - Files to add/edit:
     - `server/src/test/unit/chat.providerFallback.test.ts` (new)
     - `server/src/test/unit/mcp2.codebaseQuestion.fallback.test.ts` (new or existing file update)
     - `server/src/test/unit/chat.models.providers.defaultSelection.test.ts` (new or existing file update)
     - `server/src/test/unit/mcp2-router-list-unavailable.test.ts` (update)
     - `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts` (update)
     - `server/src/test/integration/chat.providerFallback.persistence.test.ts` (new)
     - `server/src/test/integration/mcp.providerFallback.persistence.test.ts` (new)
   - Cases:
     - fallback switches at most once (`codex -> lmstudio` or `lmstudio -> codex`)
     - resolved fallback provider/model are what get persisted on the conversation record
     - chat UI defaults select an available provider/model when configured defaults are unavailable
     - when neither provider is available, REST returns existing `503 PROVIDER_UNAVAILABLE` envelope
     - when neither provider is available, MCP returns existing `-32001 CODE_INFO_LLM_UNAVAILABLE` error
     - MCP v2 `tools/list` remains available when Codex is unavailable
8. [ ] Add server Cucumber contract scenarios for provider fallback and terminal unavailable behavior.
   - Files to add/edit:
     - `server/src/test/features/chat-provider-fallback.feature` (new)
     - `server/src/test/steps/chatProviderFallback.steps.ts` (new)
9. [ ] Update documentation for runtime auto-fallback and model selection rules.
   - Files to edit:
     - `design.md`
     - `README.md`
10. [ ] Update `projectStructure.md` if files were added/removed.
11. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- providerFallback`
6. [ ] `npm run test --workspace server -- codebaseQuestion`
7. [ ] `npm run test --workspace server -- chat.models`
8. [ ] `npm run test --workspace server -- providerFallback.persistence`
9. [ ] `npm run test --workspace server`
10. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 3. Server: Raw-input acceptance policy and whitespace-only rejection message contracts

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Implement server-side non-empty-content enforcement without trimming valid user payloads and lock exact rejection messages for chat and agents endpoints. This task is intentionally separate and must complete before frontend send-path changes.

#### Documentation Locations

- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html
- Express 5 error handling: https://expressjs.com/en/guide/error-handling.html
- HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110
- Cucumber guides: https://cucumber.io/docs/guides/
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current request validation and trimming behavior.
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/agentsRun.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
2. [ ] Update REST chat validation to reject only whitespace-only/newline-only content while preserving raw non-whitespace payload.
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
   - Required error:
     - `400 { status: "error", code: "VALIDATION_FAILED", message: "message must contain at least one non-whitespace character" }`
3. [ ] Update agents run validation to same semantic rule with agents envelope.
   - Files to edit:
     - `server/src/routes/agentsRun.ts`
   - Required error:
     - `400 { error: "invalid_request", message: "instruction must contain at least one non-whitespace character" }`
4. [ ] Add validation contract tests for both endpoints.
   - Files to add/edit:
     - `server/src/test/unit/chatValidators.messageContent.test.ts` (new)
     - `server/src/test/unit/agentsRun.validation.test.ts` (new or existing update)
   - Cases:
     - whitespace-only rejected with exact message
     - newline-only rejected with exact message
     - leading/trailing whitespace with real content accepted and preserved
5. [ ] Add server Cucumber contract scenarios for whitespace-only rejection message contracts.
   - Files to add/edit:
     - `server/src/test/features/chat-agent-input-validation.feature` (new)
     - `server/src/test/steps/chatAgentInputValidation.steps.ts` (new)
6. [ ] Update API docs/spec for exact validation messages.
   - Files to edit:
     - `openapi.json`
     - `README.md`
     - `design.md`
7. [ ] Update `projectStructure.md` if files were added/removed.
8. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- chatValidators`
6. [ ] `npm run test --workspace server -- agentsRun`
7. [ ] `npm run test --workspace server`
8. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 4. Server: MCP keepalive helper unification across all MCP surfaces

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Create one shared keepalive helper and use it for classic MCP, MCP v2, and agents MCP long-running tool calls. This task only covers keepalive lifecycle behavior and does not add tools or change business contracts.

#### Documentation Locations

- MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools
- JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259
- Node.js timers API: https://nodejs.org/api/timers.html
- Node.js HTTP response lifecycle: https://nodejs.org/api/http.html
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review existing keepalive implementations and lifecycle hooks.
   - Files to read:
     - `server/src/mcp2/router.ts`
     - `server/src/mcpAgents/router.ts`
     - `server/src/mcp/server.ts`
2. [ ] Implement shared keepalive utility under `mcpCommon`.
   - Files to edit:
     - `server/src/mcpCommon/keepAlive.ts` (new file)
   - Required behavior:
     - one shared heartbeat interval constant and initial-flush behavior reused by all three MCP surfaces
     - start/stop API
     - safe write wrapper
     - cleanup on success/error/end/close
     - whitespace-only heartbeat writes
3. [ ] Replace MCP v2 local keepalive logic with shared helper.
   - Files to edit:
     - `server/src/mcp2/router.ts`
4. [ ] Replace agents MCP local keepalive logic with shared helper.
   - Files to edit:
     - `server/src/mcpAgents/router.ts`
5. [ ] Add keepalive to classic MCP route for long-running `tools/call`.
   - Files to edit:
     - `server/src/mcp/server.ts`
6. [ ] Add server tests covering helper lifecycle and no write-after-close behavior.
   - Files to add/edit:
     - `server/src/test/unit/mcp.keepalive.helper.test.ts` (new)
     - `server/src/test/unit/mcp.server.keepalive.test.ts` (new/update)
     - `server/src/test/unit/mcp2.router.keepalive.test.ts` (new/update)
     - `server/src/test/unit/mcpAgents.router.keepalive.test.ts` (new/update)
   - Required cases:
     - keepalive starts before tool dispatch on all three surfaces
     - keepalive stops on success, thrown error, socket close, and response end
     - no heartbeat writes occur after response end/close
7. [ ] Update docs for shared MCP keepalive behavior.
   - Files to edit:
     - `design.md`
8. [ ] Update `projectStructure.md` if files were added/removed.
9. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- keepalive`
6. [ ] `npm run test --workspace server -- mcp.server.keepalive`
7. [ ] Manual JSON parse smoke: invoke long-running MCP tool on each surface and confirm client parses final JSON-RPC payload.
8. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 5. Server: `reingest_repository` shared service + canonical validation/error mapping

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Build a shared re-ingest service that enforces strict existing-root-only safety and returns canonical success/error payloads for both MCP surfaces. This task does not wire endpoints yet; it produces the shared engine and contract mapping.

#### Documentation Locations

- MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
- Node.js path utilities: https://nodejs.org/api/path.html
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current ingest re-embed and repository listing behavior.
   - Files to read:
     - `server/src/routes/ingestReembed.ts`
     - `server/src/lmstudio/toolService.ts`
     - `server/src/ingest/*` (relevant service files)
2. [ ] Create shared `reingest_repository` service with strict `sourceId` validation and root matching.
   - Files to edit:
     - `server/src/ingest/reingestService.ts` (new file)
   - Required validation:
     - missing/non-string/empty/non-absolute/non-normalized/unknown -> failure
     - ambiguous path forms (`..` segments, mixed slash styles, trailing-slash variants that cannot map uniquely) -> failure
     - only exact known ingested root match allowed
3. [ ] Implement canonical contract mappers for success and error `data` payloads.
   - Files to edit:
     - `server/src/ingest/reingestService.ts`
   - Required outputs:
     - success: `{ status, operation, runId, sourceId }`
     - errors: `INVALID_PARAMS`, `NOT_FOUND`, `BUSY` with required `error.data` retry payloads
     - include deterministic `fieldErrors.reason` values and `reingestableRepositoryIds` + `reingestableSourceIds` where required by the story contract
4. [ ] Add unit tests for all validation and busy-state branches.
   - Files to add/edit:
     - `server/src/test/unit/reingestService.test.ts` (new)
   - Required cases:
     - every invalid `sourceId` reason branch maps to the expected `error.code`/`error.message`
     - unknown root response includes AI-retry guidance fields
     - busy response maps to canonical `BUSY` contract
5. [ ] Update docs for canonical error contract and retry fields.
   - Files to edit:
     - `design.md`
     - `README.md`
6. [ ] Update `projectStructure.md` if files were added/removed.
7. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- reingestService`
6. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 6. Server: Wire `reingest_repository` into classic MCP (`POST /mcp`)

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Expose `reingest_repository` on the classic MCP surface and map service outputs into existing classic MCP response envelopes. This task only covers classic MCP wiring.

#### Documentation Locations

- MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review classic MCP tool registration and call dispatch flow.
   - Files to read:
     - `server/src/mcp/server.ts`
     - `server/src/mcp/types.ts` (if present)
2. [ ] Add tool metadata in `tools/list` for `reingest_repository`.
   - Files to edit:
     - `server/src/mcp/server.ts`
3. [ ] Add `tools/call` handler wiring to shared re-ingest service.
   - Files to edit:
     - `server/src/mcp/server.ts`
   - Contract requirements:
     - success and error maps exactly to plan `Message Contracts & Storage Shapes`.
4. [ ] Add classic MCP tests for list + call success + each error code.
   - Files to add/edit:
     - `server/src/test/unit/mcp.reingest.classic.test.ts` (new)
   - Required cases:
     - failures are emitted as JSON-RPC `error` envelopes (not `result.isError`)
     - `INVALID_PARAMS`/`NOT_FOUND` include canonical retry guidance fields in `error.data`
     - `BUSY` maps to `error.code=429`, `error.message="BUSY"`
5. [ ] Update docs with classic MCP tool exposure.
   - Files to edit:
     - `README.md`
     - `design.md`
6. [ ] Update `projectStructure.md` if files were added/removed.
7. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- mcp.reingest.classic`
6. [ ] Manual smoke: `initialize` -> `tools/list` -> `tools/call reingest_repository` on `POST /mcp`
7. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 7. Server: Wire `reingest_repository` into MCP v2 tools surface

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Expose `reingest_repository` on MCP v2 and enforce the exact same name and contract as classic MCP. This task only covers MCP v2 wiring and parity verification.

#### Documentation Locations

- MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review MCP v2 tool registry and dispatch path.
   - Files to read:
     - `server/src/mcp2/tools.ts`
     - `server/src/mcp2/router.ts`
     - `server/src/mcp2/tools/*` (related modules)
2. [ ] Add MCP v2 tool definition for `reingest_repository`.
   - Files to edit:
     - `server/src/mcp2/tools.ts`
     - `server/src/mcp2/tools/reingestRepository.ts` (new file)
3. [ ] Wire tool execution to shared re-ingest service with canonical error mapping.
   - Files to edit:
     - `server/src/mcp2/tools/reingestRepository.ts`
4. [ ] Add MCP v2 tests for list + call success + each error contract branch.
   - Files to add/edit:
     - `server/src/test/unit/mcp2.reingest.tool.test.ts` (new)
   - Required cases:
     - failures are emitted as JSON-RPC `error` envelopes (not `result.isError`)
     - `INVALID_PARAMS`/`NOT_FOUND` include canonical retry guidance fields in `error.data`
     - `BUSY` maps to `error.code=429`, `error.message="BUSY"`
5. [ ] Add parity tests comparing classic MCP and MCP v2 response shapes for same inputs.
   - Files to add/edit:
     - `server/src/test/unit/mcp.reingest.parity.test.ts` (new)
   - Required cases:
     - success payload parity
     - error envelope parity (code/message/data) for `INVALID_PARAMS`, `NOT_FOUND`, and `BUSY`
6. [ ] Update docs for MCP v2 tool availability and parity.
   - Files to edit:
     - `README.md`
     - `design.md`
7. [ ] Update `projectStructure.md` if files were added/removed.
8. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- mcp2.reingest`
6. [ ] Manual smoke: `initialize` -> `tools/list` -> `tools/call reingest_repository` on MCP v2 port
7. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 8. Server: Codex stream merge fix for cropped/duplicate assistant output

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Fix server stream aggregation so tool-interleaved Codex runs do not produce cropped starts or duplicated final text. This task is limited to stream assembly correctness and keeps existing bubble UI/chrome behavior unchanged.

#### Documentation Locations

- OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server
- OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md
- Node.js streams/events: https://nodejs.org/api/stream.html
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current Codex event merge path and publication boundaries.
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/chat/inflightRegistry.ts`
2. [ ] Implement item-keyed merge strategy and completed-item authoritative finalization.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Required behavior:
     - no prefix-only assumption
     - prevent duplicate final append
     - ignore stale/late post-completion deltas per item
3. [ ] Stabilize final publish path to avoid double finalization across bridge/inflight boundaries.
   - Files to edit:
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/chat/inflightRegistry.ts` (if required)
4. [ ] Add regression tests for non-monotonic, tool-interleaved event order.
   - Files to add/edit:
     - `server/src/test/unit/chat.codex.streamMerge.test.ts` (new)
     - `server/src/test/unit/chat.streamBridge.finalization.test.ts` (new/update)
   - Required scenarios:
     - initial text -> tool call -> truncated/non-prefix update -> completed final
     - interleaved updates across multiple assistant item ids in one turn
     - completed event followed by late delta
     - ensure final answer published once
5. [ ] Update docs for Codex merge invariants and finalization rules.
   - Files to edit:
     - `design.md`
6. [ ] Update `projectStructure.md` if files were added/removed.
7. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- codex.streamMerge`
6. [ ] `npm run test --workspace server -- streamBridge`
7. [ ] Manual smoke: run Codex chat with tool call and verify no cropped/duplicate final text
8. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 9. Client: Chat page raw-input send behavior + user bubble markdown parity

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Update Chat page send behavior to preserve raw user text and render user bubbles with the same markdown/sanitization stack as assistant bubbles. This task depends on server validation/message contracts already implemented in Task 3.

#### Documentation Locations

- React docs (forms/events): https://react.dev/reference/react-dom/components/textarea
- `react-markdown` docs: https://github.com/remarkjs/react-markdown
- `remark-gfm` docs: https://github.com/remarkjs/remark-gfm
- `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize
- Playwright docs (Context7): `/microsoft/playwright`
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current chat send-path trimming and user bubble rendering.
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/components/Markdown.tsx`
2. [ ] Remove client-side trim mutation from chat send path while preserving empty-input guard UX.
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatStream.ts`
   - Constraints:
     - do not mutate payload text before send when content is non-whitespace
     - keep local "cannot send empty" behavior aligned with server rule
     - remove user-turn dedupe comparisons that normalize/collapse whitespace so distinct raw inputs remain distinct in transcript hydration
3. [ ] Render chat user bubbles with shared markdown renderer used by assistant bubbles.
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Constraints:
     - use `client/src/components/Markdown.tsx`
     - preserve current bubble container layout/chrome
4. [ ] Add chat UI tests for raw payload preservation and markdown parity.
   - Files to add/edit:
     - `client/src/test/chatPage.userMarkdown.test.tsx` (new)
     - `client/src/test/useChatStream.rawInput.test.tsx` (new/update)
   - Required cases:
     - leading/trailing whitespace preserved in sent payload
     - newline formatting preserved
     - messages that differ only by whitespace are not merged/deduped into one user turn
     - user bubble markdown features (including mermaid fences) mirror assistant rendering
5. [ ] Add Chat e2e coverage for user-visible raw-input + markdown rendering behavior.
   - Files to add/edit:
     - `e2e/chat-user-markdown.spec.ts` (new)
   - Required checks:
     - outbound payload preserves leading/trailing whitespace for non-empty content
     - user bubble markdown/mermaid rendering matches assistant renderer behavior
6. [ ] Update docs for chat user markdown parity behavior.
   - Files to edit:
     - `README.md`
     - `design.md`
7. [ ] Update `projectStructure.md` if files were added/removed.
8. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client -- chatPage.userMarkdown`
6. [ ] `npm run test --workspace client -- useChatStream.rawInput`
7. [ ] `npm run e2e:test -- e2e/chat-user-markdown.spec.ts`
8. [ ] Manual smoke: Chat UI send multiline markdown and verify user bubble formatting matches assistant markdown renderer
9. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 10. Client: Agents page raw-input send behavior + user bubble markdown parity

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Update Agents page send behavior to preserve raw user text and render user bubbles with the same markdown/sanitization profile as assistant bubbles. This is scoped to Agents UI only and follows the server validation/messages established earlier.

#### Documentation Locations

- React docs (forms/events): https://react.dev/reference/react-dom/components/textarea
- `react-markdown` docs: https://github.com/remarkjs/react-markdown
- `remark-gfm` docs: https://github.com/remarkjs/remark-gfm
- `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize
- Playwright docs (Context7): `/microsoft/playwright`
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Review current agents send-path trimming and user bubble rendering.
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/Markdown.tsx`
2. [ ] Remove client-side trim mutation from agents send payload while preserving empty-input guard UX.
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
3. [ ] Render agents user bubbles with shared markdown renderer used by assistant bubbles.
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
4. [ ] Add agents UI tests for raw payload preservation and markdown parity.
   - Files to add/edit:
     - `client/src/test/agentsPage.userMarkdown.test.tsx` (new)
     - `client/src/test/agentsPage.run.instructionError.test.tsx` (update if needed)
   - Required cases:
     - leading/trailing whitespace preserved in outbound payload
     - multiline formatting preserved
     - agent user turns that differ only by whitespace are not merged in transcript hydration
     - user bubble markdown rendering (including mermaid fences) matches assistant rendering
5. [ ] Add Agents e2e coverage for user-visible raw-input + markdown rendering behavior.
   - Files to add/edit:
     - `e2e/agents-user-markdown.spec.ts` (new)
   - Required checks:
     - outbound payload preserves leading/trailing whitespace for non-empty content
     - user bubble markdown/mermaid rendering matches assistant renderer behavior
6. [ ] Update docs for agents user markdown parity behavior.
   - Files to edit:
     - `README.md`
     - `design.md`
7. [ ] Update `projectStructure.md` if files were added/removed.
8. [ ] Run lint/format checks for workspace.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client -- agentsPage.userMarkdown`
6. [ ] `npm run e2e:test -- e2e/agents-user-markdown.spec.ts`
7. [ ] Manual smoke: Agents UI send multiline markdown and verify user bubble formatting parity
8. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 11. Final verification: acceptance check, full regressions, and documentation normalization

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Validate every acceptance criterion end-to-end after all feature tasks are complete, run full regression layers (Jest, Cucumber, e2e), and finish all documentation and PR summary output.

#### Documentation Locations

- Docker docs (Context7): `/docker/docs`
- Playwright docs (Context7): `/microsoft/playwright`
- Jest docs (Context7): `/jestjs/jest`
- Cucumber guides: https://cucumber.io/docs/guides/
- Mermaid docs (Context7): `/mermaid-js/mermaid`

#### Subtasks

1. [ ] Re-check all acceptance criteria against implemented behavior and mark any gap before final testing.
   - Files to read:
     - `planning/0000035-mcp-keepalive-defaults-reingest-and-chat-rendering.md`
2. [ ] Ensure documentation is fully synchronized with final code behavior.
   - Files to edit:
     - `README.md`
     - `design.md`
     - `projectStructure.md`
3. [ ] Prepare manual verification artifacts in `test-results/screenshots/` with naming `0000035-11-<label>.png`.
4. [ ] Create a PR summary comment covering all task outcomes, contract changes, and verification evidence.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run test --workspace server`
7. [ ] `npm run e2e`
8. [ ] Manual Playwright-MCP walkthrough of Chat, Agents, and MCP flows with screenshots saved to `test-results/screenshots/`
9. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---
