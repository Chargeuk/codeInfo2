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
- Detailed regression matrix definition remains deferred for later planning, but final implementation must include Cucumber, Jest, and e2e coverage.
- Unrelated public contracts stay unchanged; only contract changes explicitly documented in this story are allowed.

## Out Of Scope

- Introducing brand-new ingest/start capabilities in MCP beyond re-ingest of existing repositories.
- Redesigning the broader chat/agents page layouts beyond user message rendering behavior.
- Reworking unrelated MCP tools or adding new MCP surfaces.
- Changing conversation persistence architecture or Mongo/Chroma schemas unless required to satisfy this story.
- General model-quality tuning unrelated to the concrete duplicate/cropped stream assembly bug.
- Changing agent execution/provider-selection architecture (agents remain Codex-driven and continue using existing agent config/default model behavior outside this story's input/rendering fixes).

## Questions

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

Wrapper example for classic MCP surface (`POST /mcp`):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\":\"started\",\"operation\":\"reembed\",\"runId\":\"ingest-1730000000000\",\"sourceId\":\"/data/my-repo\"}"
      }
    ]
  }
}
```

Wrapper example for MCP v2 surface (`MCP_PORT` JSON-RPC):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\":\"started\",\"operation\":\"reembed\",\"runId\":\"ingest-1730000000000\",\"sourceId\":\"/data/my-repo\"}"
      }
    ]
  }
}
```

Canonical JSON-RPC error envelope used on both MCP surfaces:
```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "error": {
    "code": 0,
    "message": "ERROR_CODE",
    "data": {}
  }
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

Compatibility note:
- MCP guidance commonly models tool execution failures as `result.isError=true`; this story intentionally keeps the JSON-RPC error envelope above for `reingest_repository` to preserve existing cross-surface behavior/contracts in this codebase.

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

Note:
- These contracts are for whitespace-only/newline-only inputs.
- Both contracts return HTTP status `400`.
- Conversation title trimming (`slice(0, 80)`) may continue for metadata/title generation and is not treated as message-content trimming.

Repository/source listing shape used to build retry options (existing contract, no schema change):
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

Ingest-root metadata storage shape used by re-ingest selection (existing storage, no schema change in this story):
- Root metadata keys currently include `root`, `name`, `description`, `model`, `state`, `lastIngestAt`, `ingestedAtMs`, file/chunk/embed counts, and optional AST counters/timestamps.
- Re-ingest selection remains strict root-based (`meta.root === sourceId` after normalization) and chooses the latest matching metadata snapshot by timestamp/run ordering.
- This story does not introduce any new persistence schema or collection.

## Implementation Ideas

- Extract the already-duplicated keepalive implementation in:
  - `server/src/mcp2/router.ts`
  - `server/src/mcpAgents/router.ts`
  into one shared helper under `server/src/mcpCommon/` (start, stop, send wrapper, close/error cleanup), then apply that helper to:
  - `server/src/mcp/server.ts` (currently no keepalive on long `/mcp` tool calls).
- Introduce one shared provider/model defaults resolver under `server/src/config/` using only:
  - `CHAT_DEFAULT_PROVIDER`
  - `CHAT_DEFAULT_MODEL`
  with precedence:
  - explicit request value -> env override -> hardcoded fallback (`codex` / `gpt-5.3-codex`).
- Ensure this precedence is applied consistently in:
  - runtime execution paths (`/chat`, `codebase_question`)
  - provider/model discovery endpoints (`/chat/providers`, `/chat/models`) used by UI defaults.
- Wire that resolver into server execution paths (not just request validation):
  - REST chat request resolution in `server/src/routes/chatValidators.ts`
  - MCP `codebase_question` execution in `server/src/mcp2/tools/codebaseQuestion.ts` (including Codex model resolution, not only LM Studio).
- Align chat page defaults with the same resolver so UI defaults match runtime defaults:
  - provider selection path (`server/src/routes/chatProviders.ts` + `client/src/hooks/useChatModel.ts`)
  - initial model selection path (`server/src/routes/chatModels.ts` + `client/src/hooks/useChatModel.ts`)
  ensuring the default provider/model shown in UI is `codex` / `gpt-5.3-codex` when env overrides are absent.
- Add runtime provider-availability fallback behavior to both UI and server selection paths:
  - selected/default provider auto-switches to the other provider when available
  - auto-switched provider uses its first available/runtime-default model
  - if fallback provider has no selectable model, treat fallback as unavailable and keep original selected/default provider
  - fallback executes once per request and persists the resolved provider/model for that request path
  - if both providers are unavailable, keep selected/default provider and surface unavailable behavior.
- Update committed env files to make intended defaults explicit:
  - `server/.env`
  - `server/.env.e2e`
  with:
  - `CHAT_DEFAULT_PROVIDER=codex`
  - `CHAT_DEFAULT_MODEL=gpt-5.3-codex`.
- Add a shared MCP re-ingest service wrapper around existing ingest primitives (`listIngestedRepositories` + `reembed`) with strict root authorization and normalized exact-match validation.
- Expose canonical tool `reingest_repository` on both MCP surfaces:
  - classic MCP router in `server/src/mcp/server.ts`
  - MCP v2 tool registry in `server/src/mcp2/tools.ts` and corresponding tool module/definition.
- Use one shared MCP response and error contract across both surfaces:
  - success payload fields: `status`, `runId`, `sourceId`, `operation: "reembed"`
  - error mapping: `-32602/INVALID_PARAMS`, `404/NOT_FOUND`, `429/BUSY`
  - AI-retry payload in `error.data` including `fieldErrors`, `reingestableRepositoryIds`, `reingestableSourceIds`.
  - include an inline comment/docstring stating this is a deliberate compatibility contract even though MCP tools docs commonly prefer `result.isError` for execution failures.
- Enforce strict source safety rules for `reingest_repository`:
  - accept only normalized absolute `sourceId` values that exactly match known ingested roots
  - reject non-string, empty, non-absolute, unknown, and ambiguous inputs with field-level detail
  - re-check root existence at execution time (not only at list/discovery time).
- Fix Codex stream assembly in `server/src/chat/interfaces/ChatInterfaceCodex.ts` using per-item tracking and authoritative completion semantics:
  - do not assume prefix-only growth for all `agent_message` updates
  - compute overlap-safe deltas per item id
  - treat completed item state as authoritative final content (per Codex event model guidance).
- Update bridge/inflight merge behavior to prevent duplicate final text on non-prefix updates:
  - `server/src/chat/chatStreamBridge.ts`
  - `server/src/chat/inflightRegistry.ts`
  (current non-prefix fallback can append full final text again).
- Keep existing chat/agents bubble styling and layout unchanged while fixing only text correctness and rendering parity.
- Render user message text via the same markdown renderer as assistant text in:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/pages/AgentsPage.tsx`
  using `client/src/components/Markdown.tsx` with identical sanitization/feature profile.
- Implement true raw-input preservation end-to-end (no trimming before send) across both client and server gates:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/hooks/useChatStream.ts`
  - `client/src/pages/AgentsPage.tsx`
  - `server/src/routes/chatValidators.ts`
  - `server/src/routes/agentsRun.ts`
  so leading/trailing whitespace and newlines are preserved into provider calls when content exists.
- Enforce non-empty semantic content validation before model execution:
  - reject whitespace-only/newline-only input with explicit validation error response
  - keep this rejection server-authoritative even if client-side send guards exist.
- Keep raw user content intact after validation:
  - remove client-side `trim()`-based send transformations in chat/agents send paths
  - remove server-side content trimming before provider calls (validation can still inspect whitespace-only semantics).
- Preserve existing non-content trims that are not part of user payload semantics:
  - path/id normalization and command metadata normalization remain unchanged.
- Add focused tests for:
  - shared keepalive helper behavior + coverage on all MCP surfaces
  - shared provider/model default resolution and fallback (`codex` / `gpt-5.3-codex`) for REST, MCP, and UI selection paths
  - MCP `reingest_repository` validation and contract conformance on both MCP surfaces
  - Codex stream tool-interleaved/non-prefix/completed-item scenarios that previously produced cropped/duplicate output
  - chat/agents user markdown parity with assistant markdown (including mermaid handling)
  - raw-input preservation with leading/trailing whitespace and newline-heavy inputs
  - final regression mix remains Cucumber + Jest + e2e (detailed matrix still deferred to later planning).
