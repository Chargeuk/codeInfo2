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

## Acceptance Criteria

- MCP keepalive behavior is implemented via shared common logic and used consistently across all MCP servers that can run long-lived tool calls.
- Only `CHAT_DEFAULT_PROVIDER` and `CHAT_DEFAULT_MODEL` are used for shared provider/model env overrides.
- Shared defaults are applied consistently in both REST chat and MCP `codebase_question`.
- When `CHAT_DEFAULT_PROVIDER` and/or `CHAT_DEFAULT_MODEL` are not set, the fallback defaults are provider `codex` and model `gpt-5.3-codex` (not the previous mixed REST/MCP behavior).
- If the selected/default provider is unavailable at runtime, provider selection automatically falls back to the other provider when available; if both are unavailable, the selected/default provider remains and existing unavailable-state behavior is shown.
- Committed `.env` files used by normal and e2e server runs include `CHAT_DEFAULT_PROVIDER=codex` and `CHAT_DEFAULT_MODEL=gpt-5.3-codex`.
- Re-ingest is exposed as an MCP tool in both the MCP server that exposes chat/codebase-question and the MCP server that exposes vector/ingest tooling.
- The canonical MCP tool name is `reingest_repository` on both MCP surfaces.
- The `reingest_repository` request contract is `{"sourceId":"<containerPath>"}` and the response contract is `{"status":"started","runId":"...","sourceId":"...","operation":"reembed"}` (returned in each surface's existing MCP wrapper format).
- `reingest_repository` uses one canonical cross-surface error contract:
  - invalid params: JSON-RPC `error.code = -32602`, `error.message = "INVALID_PARAMS"`
  - unknown root: JSON-RPC `error.code = 404`, `error.message = "NOT_FOUND"`
  - ingest busy: JSON-RPC `error.code = 429`, `error.message = "BUSY"`
- All `sourceId` validation failures return field-level details and retry guidance for AI callers, including a list of currently re-ingestable repository ids/sourceIds that can be retried immediately.
- MCP re-ingest can only target repositories that are already present in ingested roots; it does not allow first-time ingest.
- `reingest_repository` validates `sourceId` with strict exact match against the known ingested root set (after normalization), and rejects non-string, empty, non-absolute, unknown, or ambiguous values.
- Codex streaming no longer produces cropped starts or duplicated final text in assistant bubbles for tool-interleaved responses.
- Existing chat/agents bubble formatting and presentation style remain unchanged while implementing the Codex stream fix.
- User message bubbles in both Chat and Agents render user content with the exact same markdown component and sanitization profile as assistant bubbles.
- User message bubbles support the same markdown feature set as assistant bubbles, including mermaid fenced blocks and existing sanitization behavior.
- User input sent to AI is preserved as full raw input with no trimming (including leading/trailing spaces and newlines) in both Chat and Agents flows.
- Whitespace-only/newline-only input is rejected before model execution, with a clear validation error from the server.
- Detailed regression matrix definition is deferred to later planning, but the final matrix for this story must include Cucumber, Jest, and e2e coverage consistent with prior story plans.
- Existing public contracts remain backward-compatible unless a contract change is explicitly agreed in this story.

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
  - Used for malformed or invalid `sourceId` (missing, non-string, empty, non-absolute, ambiguous format).
- Unknown root:
  - `error.code`: `404`
  - `error.message`: `"NOT_FOUND"`
  - Used when `sourceId` is syntactically valid but does not exactly match a known ingested root after normalization.
- Busy:
  - `error.code`: `429`
  - `error.message`: `"BUSY"`
  - Used when ingest/reembed lock is currently held and the operation cannot start.

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
