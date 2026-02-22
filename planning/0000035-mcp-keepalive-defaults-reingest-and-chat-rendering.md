# Story 0000035 - MCP keepalive/defaults, re-ingest MCP tools, Codex stream dedupe, and user markdown rendering

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo's planning style):

- Each task's **Documentation Locations** section contains external references only (website docs, Context7 library docs, Deepwiki MCP docs where needed).
- Repo file paths to read/edit are listed only inside **Subtasks**.

## Description

CodeInfo2 currently has a few related reliability and consistency gaps across MCP, chat, and agents UX.

On the MCP side, keepalive handling is implemented separately in each server, so long-running tool-call behavior is duplicated and can drift across surfaces. Default chat provider/model behavior is also split across REST and MCP paths, which makes runtime behavior harder to predict unless model/provider are always explicitly supplied.

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

- Keepalive timer logic is currently duplicated in all three MCP surfaces (`server/src/mcp/server.ts`, `server/src/mcp2/router.ts`, and `server/src/mcpAgents/router.ts`) with separate local implementations.
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

### Research Findings (2026-02-22, Library/Version Validation Pass)

- Repository lockfile confirms currently resolved versions used by this story surface:
  - React `19.2.0`, React Router `7.9.6`, `@mui/material` `6.5.0`, Express `5.1.0`, Mongoose `9.0.1`, TypeScript `5.9.3`, `@openai/codex-sdk` `0.101.0`.
  - Source: `package-lock.json`
- React form/textarea docs confirm controlled inputs read exact user-entered value (`onChange` with `e.target.value`), which supports raw-input preservation in client send paths; whitespace-only rejection remains an application policy decision.
  - Source: https://react.dev/reference/react-dom/components/textarea
- Express 5 behavior supports async/promise route error propagation to error middleware, so existing structured JSON error-envelope handling remains valid for this story's validation and fallback branches.
  - Sources:
    - https://expressjs.com/en/guide/error-handling.html
    - https://github.com/expressjs/express/blob/v5.1.0/History.md
- Mongoose 9 guidance confirms schema-level strictness remains explicit and stable; this supports this story's "no Mongo schema changes" scope while implementing logic-layer behavior only.
  - Source: https://mongoosejs.com/docs/guide.html
- MUI client surfaces in this story rely on stable v6 components (`Typography`, `TextField`, layout primitives). MUI MCP docs currently expose `6.4.12`, which is API-compatible for the interfaces touched here with resolved `6.5.0`.
  - Sources:
    - https://llms.mui.com/material-ui/6.4.12/components/typography.md
    - https://llms.mui.com/material-ui/6.4.12/components/text-fields.md

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
- Replace the classic MCP router's local keepalive block in `server/src/mcp/server.ts` with the same shared helper for long-running `/mcp` tool calls.
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
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.)
- Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.)
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.)
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for the unit tests added in this task.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: authoritative syntax/specification reference for architecture diagrams updated in `design.md` by this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review existing defaulting behavior and current fallbacks.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
     - `server/.env`
     - `server/.env.e2e`
2. [ ] Create shared resolver module for provider/model defaults.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/config/chatDefaults.ts` (new file)
   - Implementation requirements:
     - Expose deterministic resolution: explicit request -> env override -> hardcoded fallback.
     - Hardcoded fallback must be exactly `provider=codex`, `model=gpt-5.3-codex`.
     - Validate unknown/empty env values as unresolved so fallback still applies.
     - Reuse existing env/default validation approach from `server/src/config/codexEnvDefaults.ts` (no duplicate enum/boolean parsing utilities).
3. [ ] Integrate resolver into REST chat validation/execution path.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/chat.ts`
   - Implementation requirements:
     - Keep existing REST envelopes unchanged.
     - Persist resolved provider/model on created/updated conversation metadata.
4. [ ] Update committed env defaults.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/.env`
     - `server/.env.e2e`
   - Required values:
     - `CHAT_DEFAULT_PROVIDER=codex`
     - `CHAT_DEFAULT_MODEL=gpt-5.3-codex`
5. [ ] Add server unit tests for shared resolver precedence and REST default application.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/unit/config.chatDefaults.test.ts` (new test file)
     - `server/src/test/unit/chatValidators.test.ts` (or nearest existing validator test file)
   - Explicit test subtasks (complete each separately):
     1. [ ] Explicit values win.
        - Test type: Unit.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`.
        - Description: Add/adjust a test that passes explicit request provider/model values and asserts resolver output uses those exact values.
        - Purpose: Prove request-level inputs have highest precedence.
     2. [ ] Env values apply when explicit values are missing.
        - Test type: Unit.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`.
        - Description: Add/adjust a test where request fields are omitted and valid env defaults are set; assert resolved provider/model come from env.
        - Purpose: Prove env overrides are used correctly as second precedence tier.
     3. [ ] Hardcoded fallback applies when env is missing/invalid.
        - Test type: Unit.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`.
        - Description: Add/adjust a test that clears/invalidates env values and asserts resolver returns `codex` + `gpt-5.3-codex`.
        - Purpose: Prove deterministic fallback behavior.
     4. [ ] Partial env override resolves missing fields via fallback.
        - Test type: Unit.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`.
        - Description: Add/adjust a test with only one env default set and assert the missing field uses hardcoded fallback.
        - Purpose: Prevent mixed unresolved state when only one env key is configured.
     5. [ ] Invalid/empty env values are ignored and never persisted as mixed invalid state.
        - Test type: Unit + route validation.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/unit/chatValidators.test.ts`.
        - Description: Add/adjust tests where env defaults are empty/invalid and assert resolver/validator drop them and resolve to valid values.
        - Purpose: Prevent invalid env configuration from leaking into runtime behavior.
6. [ ] Update `design.md` for shared defaults architecture behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Update architecture notes for provider/model default precedence and REST application flow.
   - Purpose: Keep architecture documentation aligned with implemented default-resolution behavior.
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show provider/model default resolution precedence (`request -> env -> hardcoded fallback`) and where this resolution is applied in the REST chat path.
7. [ ] Update `README.md` for shared defaults runtime behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document shared provider/model defaults and how env/request precedence works.
   - Purpose: Provide accurate operator/developer usage guidance for runtime defaults.
8. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
9. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
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
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.)
- MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.)
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.)
- Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.)
- Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.)
- Cucumber guides index: https://cucumber.io/docs/guides/ (Reason: required top-level cucumber guides reference for all cucumber tasking in this story.)
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for unit and integration tests in this task.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: authoritative syntax/specification reference for architecture diagrams updated in `design.md` by this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review provider availability sources and current fallback behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `server/src/config/chatDefaults.ts` (if already created in Task 1)
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/mcp2/router.ts`
2. [ ] Extend shared resolver/runtime selection logic with single-hop auto-fallback.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/config/chatDefaults.ts`
     - `server/src/routes/chat.ts`
   - Required behavior:
     - If selected/default provider unavailable and other provider available, switch once.
     - Select fallback provider first available/runtime-default model.
     - If no fallback model/provider available, keep original provider and return existing unavailable behavior.
3. [ ] Apply shared default resolution order and runtime fallback behavior to MCP `codebase_question`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcp2/tools/codebaseQuestion.ts`
4. [ ] Apply the same deterministic availability-fallback/default-selection behavior to chat UI default sources.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
5. [ ] Ensure resolved provider/model persistence is correct for existing conversations when fallback switches provider.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mongo/repo.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
   - Required behavior:
     - metadata update helpers can persist `provider` as well as `model`
     - extend the existing `updateConversationMeta` path rather than introducing a parallel conversation-metadata updater
     - REST `/chat` updates existing conversation provider/model to the resolved execution provider/model
     - MCP `codebase_question` updates existing conversation provider/model to the resolved execution provider/model
6. [ ] Remove global Codex-only router pre-blocking that prevents provider-aware fallback for `codebase_question`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcp2/router.ts`
   - Constraint:
     - Keep existing terminal unavailable envelopes/codes unchanged.
7. [ ] Add tests for runtime fallback determinism, persistence, UI default selection, and terminal unavailable contracts.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` (update existing suite)
     - `server/src/test/unit/chatModels.codex.test.ts` (update existing suite)
     - `server/src/test/unit/mcp2-router-list-unavailable.test.ts` (update)
     - `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts` (update)
     - `server/src/test/integration/chat-codex.test.ts` (update existing suite for REST fallback behavior)
     - `server/src/test/integration/chat-assistant-persistence.test.ts` (update existing suite for persistence assertions)
     - `server/src/test/integration/chat-codex-mcp.test.ts` (update existing suite for MCP persistence assertion)
   - Explicit test subtasks (complete each separately):
     1. [ ] Single-hop provider switch.
        - Test type: Integration + MCP tool happy path.
        - Test location: `server/src/test/integration/chat-codex.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`.
        - Description: Add/adjust tests where initial provider is unavailable and alternate is available; assert exactly one switch occurs.
        - Purpose: Prove fallback does not oscillate.
     2. [ ] Fallback provider/model persistence on conversation metadata.
        - Test type: Integration persistence.
        - Test location: `server/src/test/integration/chat-assistant-persistence.test.ts`, `server/src/test/integration/chat-codex-mcp.test.ts`.
        - Description: Add/adjust tests asserting stored conversation provider/model match resolved execution provider/model after fallback.
        - Purpose: Ensure persistence aligns with actual execution path.
     3. [ ] Chat UI defaults choose available provider/model when configured defaults are unavailable.
        - Test type: Unit route test.
        - Test location: `server/src/test/unit/chatModels.codex.test.ts`.
        - Description: Add/adjust tests for default model/provider endpoints where configured defaults are unavailable and alternate is available.
        - Purpose: Keep UI default selection deterministic and runnable.
     4. [ ] Fallback dead-end when alternate provider has no selectable model.
        - Test type: Integration + MCP unavailable-path.
        - Test location: `server/src/test/integration/chat-codex.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`.
        - Description: Add/adjust tests where alternate provider exists but has no model; assert existing unavailable behavior for original provider.
        - Purpose: Prevent silent invalid fallback execution.
     5. [ ] REST unavailable contract when neither provider can run.
        - Test type: Integration error contract.
        - Test location: `server/src/test/integration/chat-codex.test.ts`.
        - Description: Add/adjust tests asserting HTTP `503` with existing `PROVIDER_UNAVAILABLE` envelope.
        - Purpose: Lock REST terminal error compatibility.
     6. [ ] MCP unavailable contract when neither provider can run.
        - Test type: MCP tool error contract.
        - Test location: `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`.
        - Description: Add/adjust tests asserting JSON-RPC error `-32001 CODE_INFO_LLM_UNAVAILABLE`.
        - Purpose: Lock MCP terminal error compatibility.
     7. [ ] MCP v2 `tools/list` remains available when Codex is unavailable.
        - Test type: Unit router contract.
        - Test location: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`.
        - Description: Add/adjust tests asserting `tools/list` succeeds without Codex availability.
        - Purpose: Preserve provider-aware fallback reachability.
8. [ ] Add server Cucumber contract scenarios for provider fallback and terminal unavailable behavior by extending existing chat feature coverage.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/features/chat_stream.feature` (update existing)
     - `server/src/test/steps/chat_stream.steps.ts` (update existing)
   - Explicit test subtasks (complete each separately):
     1. [ ] Alternate provider executes when selected/default provider is unavailable.
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario with unavailable selected provider and available alternate provider; assert request completes via alternate.
        - Purpose: Prove runtime fallback at behavior-contract level.
     2. [ ] No-model alternate provider returns existing unavailable contract.
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario where alternate provider has no selectable model; assert existing unavailable response contract.
        - Purpose: Lock fallback dead-end behavior.
     3. [ ] No provider switch when selected/default provider is available.
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario proving execution remains on selected/default provider when available.
        - Purpose: Prevent unnecessary provider switching.
9. [ ] Update `design.md` for runtime auto-fallback/model-selection architecture.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document single-hop fallback decisions, fallback model selection, and resolved provider/model persistence flow.
   - Purpose: Keep architecture-level fallback behavior concrete and auditable for future changes.
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show single-hop provider fallback decisions, fallback model selection, and persistence of resolved provider/model for REST and MCP `codebase_question`.
10. [ ] Update `README.md` for runtime auto-fallback/model-selection behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document runtime provider availability fallback behavior and user-visible model/provider selection outcomes.
   - Purpose: Ensure operational docs match fallback behavior exposed to clients and tooling.
11. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
12. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- chat-codex`
6. [ ] `npm run test --workspace server -- codebaseQuestion`
7. [ ] `npm run test --workspace server -- chatModels.codex`
8. [ ] `npm run test --workspace server -- chat-assistant-persistence`
9. [ ] `npm run test --workspace server -- chat-codex-mcp`
10. [ ] `npm run test --workspace server -- mcp2-router-list-unavailable`
11. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 3. Server: Raw-input acceptance policy and whitespace-only rejection message contracts

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Implement server-side non-empty-content enforcement without trimming valid user payloads and lock exact rejection messages for chat and agents endpoints. This task is intentionally separate and must complete before frontend send-path changes.

#### Documentation Locations
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.)
- Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.)
- HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.)
- Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.)
- Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.)
- Cucumber guides index: https://cucumber.io/docs/guides/ (Reason: required top-level cucumber guides reference for all cucumber tasking in this story.)
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for unit validation tests in this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review current request validation and trimming behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/agentsRun.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
2. [ ] Update REST chat validation to reject only whitespace-only/newline-only content while preserving raw non-whitespace payload.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
   - Required error:
     - `400 { status: "error", code: "VALIDATION_FAILED", message: "message must contain at least one non-whitespace character" }`
3. [ ] Update agents run validation to same semantic rule with agents envelope.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/routes/agentsRun.ts`
   - Required error:
     - `400 { error: "invalid_request", message: "instruction must contain at least one non-whitespace character" }`
4. [ ] Add validation contract tests for both endpoints.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/unit/chatValidators.test.ts` (update existing suite)
     - `server/src/test/unit/agents-router-run.test.ts` (update existing suite)
   - Explicit test subtasks (complete each separately):
     1. [ ] Whitespace-only payload is rejected with exact contract message.
        - Test type: Unit route validation.
        - Test location: `server/src/test/unit/chatValidators.test.ts`, `server/src/test/unit/agents-router-run.test.ts`.
        - Description: Add/adjust tests that send whitespace-only payloads and assert exact endpoint-specific 400 message envelopes.
        - Purpose: Lock contract correctness for empty-content rejection.
     2. [ ] Newline-only payload is rejected with exact contract message.
        - Test type: Unit route validation.
        - Test location: `server/src/test/unit/chatValidators.test.ts`, `server/src/test/unit/agents-router-run.test.ts`.
        - Description: Add/adjust tests for newline-only payloads and assert exact endpoint-specific 400 message envelopes.
        - Purpose: Cover newline-only corner case explicitly.
     3. [ ] Leading/trailing whitespace with real content is accepted and preserved.
        - Test type: Unit route validation.
        - Test location: `server/src/test/unit/chatValidators.test.ts`, `server/src/test/unit/agents-router-run.test.ts`.
        - Description: Add/adjust tests with non-whitespace content surrounded by whitespace and assert payload is accepted unchanged.
        - Purpose: Prevent unintended trim mutation.
5. [ ] Add server Cucumber contract scenarios for whitespace-only rejection message contracts by extending existing chat stream contract coverage.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/features/chat_stream.feature` (update existing)
     - `server/src/test/steps/chat_stream.steps.ts` (update existing)
   - Explicit test subtasks (complete each separately):
     1. [ ] Chat whitespace-only request contract.
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario sending whitespace-only chat input and asserting exact `VALIDATION_FAILED` message contract.
        - Purpose: Verify HTTP contract from a behavior-test perspective.
     2. [ ] Chat newline-only request contract.
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario sending newline-only chat input and asserting exact 400 message contract.
        - Purpose: Cover newline-only edge case in feature-level tests.
     3. [ ] Chat valid payload with surrounding whitespace remains accepted.
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario where payload includes leading/trailing whitespace plus real content and assert successful acceptance.
        - Purpose: Ensure valid raw input is not rejected.
6. [ ] Update `openapi.json` for exact validation message contracts.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `openapi.json`
7. [ ] Update `README.md` for raw-input validation and rejection message behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document whitespace-only/newline-only rejection rules and exact error message contracts.
   - Purpose: Keep user-facing API behavior documentation accurate.
8. [ ] Update `design.md` for raw-input validation flow and contracts.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Update architecture/contract notes for raw payload preservation and whitespace-only rejection logic.
   - Purpose: Ensure design-level validation semantics remain precise and testable.
9. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
10. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- chatValidators`
6. [ ] `npm run test --workspace server -- agents-router-run`
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
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.)
- JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.)
- Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.)
- Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for keepalive helper/unit/integration tests.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: authoritative syntax/specification reference for architecture diagrams updated in `design.md` by this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review existing keepalive implementations and lifecycle hooks.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `server/src/mcp2/router.ts`
     - `server/src/mcpAgents/router.ts`
     - `server/src/mcp/server.ts`
2. [ ] Implement shared keepalive utility under `mcpCommon`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcpCommon/keepAlive.ts` (new file)
   - Required behavior:
     - one shared heartbeat interval constant and initial-flush behavior reused by all three MCP surfaces
     - start/stop API
     - safe write wrapper
     - cleanup on success/error/end/close
     - whitespace-only heartbeat writes
3. [ ] Replace MCP v2 local keepalive logic with shared helper.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcp2/router.ts`
4. [ ] Replace agents MCP local keepalive logic with shared helper.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcpAgents/router.ts`
5. [ ] Replace classic MCP local keepalive logic with shared helper for long-running `tools/call`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcp/server.ts`
6. [ ] Add server tests covering helper lifecycle and no write-after-close behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/unit/mcp.keepalive.helper.test.ts` (new)
     - `server/src/test/unit/mcp2-router-list-happy.test.ts` (update existing suite)
     - `server/src/test/unit/mcp-agents-router-run.test.ts` (update existing suite)
     - `server/src/test/integration/mcp-server.test.ts` (update existing suite)
   - Explicit test subtasks (complete each separately):
     1. [ ] Keepalive starts before tool dispatch on all MCP surfaces.
        - Test type: Unit + integration.
        - Test location: `server/src/test/unit/mcp.keepalive.helper.test.ts`, `server/src/test/unit/mcp2-router-list-happy.test.ts`, `server/src/test/unit/mcp-agents-router-run.test.ts`.
        - Description: Add/adjust tests asserting keepalive start is observed before tool execution begins for classic, v2, and agents surfaces.
        - Purpose: Prevent delayed keepalive initialization regressions.
     2. [ ] Keepalive stops on success/error/close/end.
        - Test type: Unit + integration.
        - Test location: `server/src/test/unit/mcp.keepalive.helper.test.ts`, `server/src/test/integration/mcp-server.test.ts`.
        - Description: Add/adjust tests that exercise success, thrown error, socket close, and response end paths and assert timer cleanup.
        - Purpose: Prevent timer leaks.
     3. [ ] No heartbeat writes after close/end.
        - Test type: Unit.
        - Test location: `server/src/test/unit/mcp.keepalive.helper.test.ts`.
        - Description: Add/adjust tests that close/end response before next tick and assert no additional writes occur.
        - Purpose: Prevent write-after-close failures.
     4. [ ] Keepalive not started for non-tool paths.
        - Test type: Router unit.
        - Test location: `server/src/test/unit/mcp2-router-list-happy.test.ts`, `server/src/test/unit/mcp-agents-router-run.test.ts`.
        - Description: Add/adjust tests for parse/invalid-request/unknown-tool paths and assert helper is not started.
        - Purpose: Keep non-tool traffic unaffected.
     5. [ ] Heartbeat bytes remain JSON whitespace only.
        - Test type: Integration contract.
        - Test location: `server/src/test/integration/mcp-server.test.ts`.
        - Description: Add/adjust tests asserting heartbeats are whitespace and final JSON payload parsing remains valid.
        - Purpose: Preserve protocol compatibility with strict JSON parsers.
7. [ ] Update docs for shared MCP keepalive behavior and architecture diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `design.md`
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show shared keepalive helper lifecycle (`start -> heartbeat -> stop`) and integration points for classic MCP, MCP v2, and agents MCP routes.
8. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
9. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- mcp.keepalive.helper`
6. [ ] `npm run test --workspace server -- mcp2-router && npm run test --workspace server -- mcp-agents-router-run && npm run test --workspace server -- mcp-server`
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
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.)
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.)
- Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.)
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for reingest service unit tests.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: authoritative syntax/specification reference for architecture diagrams updated in `design.md` by this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review current ingest re-embed and repository listing behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `server/src/routes/ingestReembed.ts`
     - `server/src/lmstudio/toolService.ts`
     - `server/src/ingest/*` (relevant service files)
2. [ ] Create shared `reingest_repository` service with strict `sourceId` validation and root matching.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/ingest/reingestService.ts` (new file)
   - Required validation:
     - missing/non-string/empty/non-absolute/non-normalized/unknown -> failure
     - ambiguous path forms (`..` segments, mixed slash styles, trailing-slash variants that cannot map uniquely) -> failure
     - only exact known ingested root match allowed
   - Reuse requirements:
     - delegate run-start semantics to existing `isBusy` and `reembed` in `server/src/ingest/ingestJob.ts`
     - derive retry option lists from existing `listIngestedRepositories` in `server/src/lmstudio/toolService.ts`
     - reuse the existing POSIX normalization strategy already used by `server/src/ingest/pathMap.ts` to avoid introducing a second path-normalization behavior
     - do not duplicate ingest-job lock or reembed execution logic
3. [ ] Implement canonical contract mappers for success and error `data` payloads.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/ingest/reingestService.ts`
   - Required outputs:
     - success: `{ status, operation, runId, sourceId }`
     - errors: `INVALID_PARAMS`, `NOT_FOUND`, `BUSY` with required `error.data` retry payloads
     - include deterministic `fieldErrors.reason` values and `reingestableRepositoryIds` + `reingestableSourceIds` where required by the story contract
4. [ ] Add unit tests for all validation and busy-state branches.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/unit/reingestService.test.ts` (new)
   - Explicit test subtasks (complete each separately):
     1. [ ] Success branch returns canonical payload.
        - Test type: Unit service contract.
        - Test location: `server/src/test/unit/reingestService.test.ts`.
        - Description: Add/adjust a success-path test asserting `status`, `operation`, `runId`, and `sourceId` fields.
        - Purpose: Lock canonical success shape.
     2. [ ] Invalid `sourceId` reason branches map to expected error code/message.
        - Test type: Unit validation contract.
        - Test location: `server/src/test/unit/reingestService.test.ts`.
        - Description: Add/adjust table-driven tests for missing, non-string, empty, non-absolute, non-normalized, and ambiguous `sourceId`.
        - Purpose: Ensure deterministic validation mapping.
     3. [ ] Unknown root response includes AI-retry guidance fields.
        - Test type: Unit error-data contract.
        - Test location: `server/src/test/unit/reingestService.test.ts`.
        - Description: Add/adjust tests asserting `reingestableRepositoryIds` and `reingestableSourceIds` are present for unknown root.
        - Purpose: Preserve AI-retry contract.
     4. [ ] Busy response maps to canonical `BUSY` contract.
        - Test type: Unit busy-state contract.
        - Test location: `server/src/test/unit/reingestService.test.ts`.
        - Description: Add/adjust tests for locked ingest state and assert `BUSY` mapping.
        - Purpose: Lock busy-state behavior.
5. [ ] Update `design.md` for canonical error/retry architecture and diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Update architecture details and Mermaid diagrams for validation branches and canonical contract mapping.
   - Purpose: Keep service-level behavior and error contracts unambiguous in architecture docs.
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show `reingest_repository` service validation branches and canonical success/error mappings (`INVALID_PARAMS`, `NOT_FOUND`, `BUSY`).
6. [ ] Update `README.md` for canonical re-ingest error/retry behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document canonical success/error payloads and retry-guidance fields for re-ingest.
   - Purpose: Ensure operators and integrators can implement against stable contracts.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
8. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
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
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.)
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.)
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.)
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for classic MCP test implementation.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: authoritative syntax/specification reference for architecture diagrams updated in `design.md` by this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review classic MCP tool registration and call dispatch flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `server/src/mcp/server.ts`
     - `server/src/mcp/types.ts` (if present)
2. [ ] Add tool metadata in `tools/list` for `reingest_repository`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcp/server.ts`
3. [ ] Add `tools/call` handler wiring to shared re-ingest service.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcp/server.ts`
   - Contract requirements:
     - success and error maps exactly to plan `Message Contracts & Storage Shapes`.
4. [ ] Add classic MCP tests for list + call success + each error code.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/unit/mcp.reingest.classic.test.ts` (new)
   - Explicit test subtasks (complete each separately):
     1. [ ] Classic MCP success payload contract.
        - Test type: Unit JSON-RPC success contract.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
        - Description: Add/adjust tests asserting wrapped text payload includes canonical `status`, `operation`, `runId`, `sourceId`.
        - Purpose: Lock success payload shape for classic MCP.
     2. [ ] Classic MCP failures use JSON-RPC `error` envelope.
        - Test type: Unit JSON-RPC error contract.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
        - Description: Add/adjust tests asserting failures are emitted through `error` (not `result.isError`).
        - Purpose: Preserve surface compatibility.
     3. [ ] Classic MCP `INVALID_PARAMS`/`NOT_FOUND` include retry guidance fields.
        - Test type: Unit error-data contract.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
        - Description: Add/adjust tests for invalid/unknown inputs asserting canonical `error.data` retry fields.
        - Purpose: Preserve retry-guidance behavior.
     4. [ ] Classic MCP `BUSY` mapping.
        - Test type: Unit busy contract.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
        - Description: Add/adjust tests asserting `error.code=429` and `error.message="BUSY"` when ingest lock is active.
        - Purpose: Lock busy error semantics.
5. [ ] Update `README.md` for classic MCP `reingest_repository` exposure.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document classic MCP tool availability and contract expectations for `reingest_repository`.
   - Purpose: Keep classic MCP usage docs aligned with implemented tool exposure.
6. [ ] Update `design.md` for classic MCP architecture flow and diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document classic MCP request flow to shared re-ingest service and contract mapping.
   - Purpose: Preserve architectural clarity of classic MCP integration behavior.
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show classic MCP `initialize -> tools/list -> tools/call(reingest_repository)` routing to the shared re-ingest service and canonical response mapping.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
8. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
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
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.)
- JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.)
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.)
- OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for MCP v2 and parity tests.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: authoritative syntax/specification reference for architecture diagrams updated in `design.md` by this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review MCP v2 tool registry and dispatch path.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `server/src/mcp2/tools.ts`
     - `server/src/mcp2/router.ts`
     - `server/src/mcp2/tools/*` (related modules)
2. [ ] Add MCP v2 tool definition for `reingest_repository`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcp2/tools.ts`
     - `server/src/mcp2/tools/reingestRepository.ts` (new file)
3. [ ] Wire tool execution to shared re-ingest service with canonical error mapping.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/mcp2/tools/reingestRepository.ts`
4. [ ] Add MCP v2 tests for list + call success + each error contract branch.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/unit/mcp2.reingest.tool.test.ts` (new)
   - Explicit test subtasks (complete each separately):
     1. [ ] MCP v2 success payload contract.
        - Test type: Unit JSON-RPC success contract.
        - Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust tests asserting wrapped payload includes canonical `status`, `operation`, `runId`, `sourceId`.
        - Purpose: Lock success payload shape for MCP v2.
     2. [ ] MCP v2 failures use JSON-RPC `error` envelope.
        - Test type: Unit JSON-RPC error contract.
        - Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust tests asserting failures use JSON-RPC `error` and not `result.isError`.
        - Purpose: Preserve surface compatibility.
     3. [ ] MCP v2 `INVALID_PARAMS`/`NOT_FOUND` include retry guidance fields.
        - Test type: Unit error-data contract.
        - Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust tests for invalid/unknown inputs asserting canonical retry guidance in `error.data`.
        - Purpose: Lock AI-retry data contract.
     4. [ ] MCP v2 `BUSY` mapping.
        - Test type: Unit busy contract.
        - Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust tests asserting `error.code=429` and `error.message="BUSY"` when ingest is locked.
        - Purpose: Lock busy error semantics.
5. [ ] Add parity assertions in existing classic/MCP-v2 suites for same inputs (avoid separate parity harness file).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/unit/mcp.reingest.classic.test.ts` (update from Task 6)
     - `server/src/test/unit/mcp2.reingest.tool.test.ts` (update)
   - Explicit test subtasks (complete each separately):
     1. [ ] Success payload parity between classic MCP and MCP v2.
        - Test type: Unit parity.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust paired assertions using equivalent inputs and compare serialized success payload shapes.
        - Purpose: Prevent cross-surface drift.
     2. [ ] Error envelope parity for `INVALID_PARAMS`, `NOT_FOUND`, and `BUSY`.
        - Test type: Unit parity.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust paired assertions comparing `code`, `message`, and `error.data` for identical failing inputs.
        - Purpose: Guarantee contract parity across MCP surfaces.
6. [ ] Update `README.md` for MCP v2 tool availability and parity expectations.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document MCP v2 tool exposure and parity guarantees relative to classic MCP.
   - Purpose: Keep integrator-facing expectations explicit and current.
7. [ ] Update `design.md` for MCP v2 architecture flow and parity diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document MCP v2 tools/list/call flow and parity relationship with classic MCP contracts.
   - Purpose: Preserve architecture-level clarity and reduce cross-surface contract drift risk.
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show MCP v2 `tools/list` and `tools/call(reingest_repository)` flow and explicit parity relationship with classic MCP contracts.
8. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
9. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
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
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.)
- OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.)
- DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.)
- Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.)
- npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for Codex stream regression suites.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: authoritative syntax/specification reference for architecture diagrams updated in `design.md` by this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review current Codex event merge path and publication boundaries.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/chat/inflightRegistry.ts`
2. [ ] Implement item-keyed merge strategy and completed-item authoritative finalization.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
   - Required behavior:
     - no prefix-only assumption
     - prevent duplicate final append
     - ignore stale/late post-completion deltas per item
3. [ ] Stabilize final publish path to avoid double finalization across bridge/inflight boundaries.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/chat/inflightRegistry.ts` (if required)
4. [ ] Add regression tests for non-monotonic, tool-interleaved event order.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `server/src/test/unit/chat-interface-codex.test.ts` (update existing suite)
     - `server/src/test/unit/ws-chat-stream.test.ts` (update existing suite)
     - `server/src/test/integration/chat-codex.test.ts` (update existing suite)
   - Explicit test subtasks (complete each separately):
     1. [ ] Truncated/non-prefix update after tool call finalizes correctly.
        - Test type: Unit merge regression.
        - Test location: `server/src/test/unit/chat-interface-codex.test.ts`.
        - Description: Add/adjust tests for initial text, tool event, non-prefix update, and completed final item content.
        - Purpose: Prevent cropped/duplicated merge behavior.
     2. [ ] Interleaved item-id updates in one turn are isolated by item id.
        - Test type: Unit merge regression.
        - Test location: `server/src/test/unit/chat-interface-codex.test.ts`.
        - Description: Add/adjust tests with multiple assistant item ids and interleaved deltas to assert isolated assembly.
        - Purpose: Prevent cross-item contamination.
     3. [ ] Late delta after completed item is ignored.
        - Test type: Unit stream regression.
        - Test location: `server/src/test/unit/ws-chat-stream.test.ts`.
        - Description: Add/adjust tests asserting late post-completion deltas do not mutate finalized content.
        - Purpose: Lock completion-authoritative behavior.
     4. [ ] Final answer publishes once per turn.
        - Test type: Integration stream regression.
        - Test location: `server/src/test/integration/chat-codex.test.ts`.
        - Description: Add/adjust tests asserting one terminal assistant publish event per turn.
        - Purpose: Prevent duplicate final bubble output.
     5. [ ] Cancelled/failed turn does not duplicate terminal assistant bubble.
        - Test type: Integration stream regression.
        - Test location: `server/src/test/integration/chat-codex.test.ts`.
        - Description: Add/adjust cancellation/failure tests asserting at most one terminal assistant bubble.
        - Purpose: Prevent duplicate terminal states.
     6. [ ] Stale inflight events do not mutate current transcript.
        - Test type: Unit/stream regression.
        - Test location: `server/src/test/unit/ws-chat-stream.test.ts`.
        - Description: Add/adjust tests with stale inflight ids and assert current conversation content remains unchanged.
        - Purpose: Prevent run-crossing corruption.
5. [ ] Update docs for Codex merge invariants/finalization rules and architecture diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `design.md`
   - `design.md` requirements:
     - Add/update Mermaid sequence diagram(s) that show item-keyed delta merge, completed-item authoritative finalization, and bridge/inflight publish boundaries that prevent duplicate final bubbles.
6. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
7. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace server -- chat-interface-codex`
6. [ ] `npm run test --workspace server -- ws-chat-stream`
7. [ ] `npm run test --workspace server -- chat-codex`
8. [ ] Manual smoke: run Codex chat with tool call and verify no cropped/duplicate final text
9. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 9. Client: Chat page raw-input send behavior

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Update Chat page send behavior to preserve raw user text exactly as entered while still blocking whitespace-only submissions. This task is scoped to outbound payload behavior only and depends on server validation/message contracts implemented in Task 3.

#### Documentation Locations
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.)
- MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.)
- MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.)
- Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for Chat page client tests in this task.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review current chat send-path trimming and outbound payload flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatStream.ts`
2. [ ] Remove client-side trim mutation from chat send path while preserving empty-input guard UX.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatStream.ts`
   - Constraints:
     - do not mutate payload text before send when content is non-whitespace
     - keep local "cannot send empty" behavior aligned with server rule
     - remove user-turn dedupe comparisons that normalize/collapse whitespace so distinct raw inputs remain distinct in transcript hydration
3. [ ] Add chat UI tests for raw payload preservation behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `client/src/test/chatPage.stream.test.tsx` (update existing suite)
     - `client/src/test/useChatStream.toolPayloads.test.tsx` (update existing suite)
   - Explicit test subtasks (complete each separately):
     1. [ ] Leading/trailing whitespace preserved in outbound payload.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/useChatStream.toolPayloads.test.tsx`, `client/src/test/chatPage.stream.test.tsx`.
        - Description: Add/adjust tests asserting non-empty payloads keep surrounding whitespace when dispatched.
        - Purpose: Prevent trim mutation regressions.
     2. [ ] Newline formatting preserved in outbound payload.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/useChatStream.toolPayloads.test.tsx`, `client/src/test/chatPage.stream.test.tsx`.
        - Description: Add/adjust tests asserting multiline payloads preserve newline structure exactly.
        - Purpose: Preserve user-authored formatting.
     3. [ ] Messages differing only by whitespace are not merged in user transcript hydration.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/chatPage.stream.test.tsx`.
        - Description: Add/adjust tests asserting whitespace-distinct inputs render as separate user turns.
        - Purpose: Prevent dedupe normalization bugs.
     4. [ ] Whitespace-only input is blocked client-side before dispatch.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/chatPage.stream.test.tsx`.
        - Description: Add/adjust tests asserting whitespace-only input never triggers send request.
        - Purpose: Keep UX aligned with server validation policy.
4. [ ] Extend existing Chat e2e coverage for raw-input outbound payload behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `e2e/chat.spec.ts` (update existing)
   - Explicit test subtasks (complete each separately):
     1. [ ] E2E: leading/trailing whitespace preserved in chat outbound payload.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat.spec.ts`.
        - Description: Add/adjust e2e assertions against captured request payload showing surrounding whitespace is preserved.
        - Purpose: Verify browser-to-server behavior in real UI flow.
     2. [ ] E2E: multiline newline structure preserved in chat outbound payload.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat.spec.ts`.
        - Description: Add/adjust e2e assertions for multiline input payload equality including newline characters.
        - Purpose: Prevent newline-loss regressions in real flow.
     3. [ ] E2E: whitespace-only input does not dispatch `POST /chat`.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat.spec.ts`.
        - Description: Add/adjust e2e assertions that submit attempt with whitespace-only input does not emit network request.
        - Purpose: Ensure client guard enforcement in UI.
5. [ ] Update `README.md` for Chat raw-input send behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document raw input preservation rules and whitespace-only guard behavior for Chat.
   - Purpose: Keep user-facing behavior docs aligned with UI send-path logic.
6. [ ] Update `design.md` for Chat raw-input send flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document Chat send-flow behavior for raw payload preservation and validation boundaries.
   - Purpose: Keep implementation design notes consistent with frontend behavior and tests.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
8. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client -- useChatStream.toolPayloads`
6. [ ] `npm run test --workspace client -- chatPage.stream`
7. [ ] `npm run e2e:test -- e2e/chat.spec.ts`
8. [ ] Manual smoke: Chat UI send multiline input with leading/trailing whitespace and verify outbound request preserves raw content while whitespace-only input is blocked
9. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 10. Client: Chat page user bubble markdown parity

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Render Chat user bubbles with the same markdown/sanitization component used by assistant bubbles, preserving existing bubble chrome/layout. This task is scoped to rendering parity and depends on Task 9 for raw-input send behavior.

#### Documentation Locations
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.)
- MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.)
- MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.)
- Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.)
- `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.)
- `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.)
- `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for Chat markdown parity test updates.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review current Chat user bubble rendering path and markdown component behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/components/Markdown.tsx`
2. [ ] Replace Chat user bubble `Typography` rendering with shared markdown renderer.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Constraints:
     - use `client/src/components/Markdown.tsx`
     - preserve current bubble container layout/chrome
3. [ ] Add Chat UI tests for user markdown parity and mermaid rendering.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `client/src/test/chatPage.markdown.test.tsx` (update existing)
     - `client/src/test/chatPage.mermaid.test.tsx` (update existing)
   - Explicit test subtasks (complete each separately):
     1. [ ] User markdown rendering parity with assistant renderer.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/chatPage.markdown.test.tsx`.
        - Description: Add/adjust tests asserting equivalent markdown input renders with same structure/styling in user and assistant bubbles.
        - Purpose: Guarantee renderer parity.
     2. [ ] User mermaid fence rendering parity.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/chatPage.mermaid.test.tsx`.
        - Description: Add/adjust tests asserting mermaid fences in user bubbles render through same path as assistant bubbles.
        - Purpose: Guarantee feature parity for diagrams.
     3. [ ] Unsafe HTML/script sanitization parity.
        - Test type: Client security regression.
        - Test location: `client/src/test/chatPage.markdown.test.tsx`, `client/src/test/chatPage.mermaid.test.tsx`.
        - Description: Add/adjust tests with unsafe inline HTML/scripts asserting sanitization matches assistant behavior.
        - Purpose: Prevent XSS/sanitization drift.
     4. [ ] Malformed mermaid fallback parity.
        - Test type: Client resilience regression.
        - Test location: `client/src/test/chatPage.mermaid.test.tsx`.
        - Description: Add/adjust tests for invalid mermaid syntax asserting same safe fallback behavior as assistant path.
        - Purpose: Prevent render crashes and behavior divergence.
4. [ ] Extend Chat e2e markdown parity coverage.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `e2e/chat.spec.ts` (update existing)
     - `e2e/chat-mermaid.spec.ts` (update existing)
   - Explicit test subtasks (complete each separately):
     1. [ ] E2E: user markdown/mermaid rendering parity with assistant path.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat.spec.ts`, `e2e/chat-mermaid.spec.ts`.
        - Description: Add/adjust e2e assertions that user markdown and mermaid output visually/functionally matches assistant rendering behavior.
        - Purpose: Validate parity at real UI runtime.
     2. [ ] E2E: malformed mermaid input follows safe fallback behavior.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat-mermaid.spec.ts`.
        - Description: Add/adjust e2e assertions that invalid mermaid input does not break page and shows expected fallback output.
        - Purpose: Validate resilience in browser execution.
5. [ ] Update `README.md` for Chat user markdown parity behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document Chat user-bubble markdown parity behavior and mermaid rendering expectations.
   - Purpose: Keep behavior documentation aligned with rendered markdown capabilities.
6. [ ] Update `design.md` for Chat user markdown parity flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document markdown rendering pipeline reuse for user bubbles, including mermaid and sanitization behavior.
   - Purpose: Keep architecture/implementation docs consistent with parity behavior.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
8. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client -- chatPage.markdown`
6. [ ] `npm run test --workspace client -- chatPage.stream`
7. [ ] `npm run test --workspace client -- chatPage.mermaid`
8. [ ] `npm run e2e:test -- e2e/chat.spec.ts e2e/chat-mermaid.spec.ts`
9. [ ] Manual smoke: Chat UI send multiline markdown and verify user bubble formatting parity
10. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 11. Client: Agents page raw-input send behavior

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Update Agents page send behavior to preserve raw user text exactly as entered while still blocking whitespace-only submissions. This task is scoped to outbound payload behavior only and depends on server validation/message contracts implemented in Task 3.

#### Documentation Locations
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.)
- MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.)
- MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.)
- Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for Agents raw-input client tests.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review current Agents send-path trimming and outbound payload flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
2. [ ] Remove client-side trim mutation from Agents send payload while preserving empty-input guard UX.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Constraints:
     - do not mutate outbound payload text before send when content is non-whitespace
     - keep local "cannot send empty" behavior aligned with server rule
3. [ ] Add Agents UI tests for raw payload preservation behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `client/src/test/agentsPage.run.test.tsx` (update existing if needed)
     - `client/src/test/agentsPage.turnHydration.test.tsx` (update existing if needed)
   - Explicit test subtasks (complete each separately):
     1. [ ] Leading/trailing whitespace preserved in agents outbound payload.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.run.test.tsx`.
        - Description: Add/adjust tests asserting non-empty instruction payload keeps leading/trailing whitespace when dispatched.
        - Purpose: Prevent trim mutation on agents path.
     2. [ ] Newline formatting preserved in agents outbound payload.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.run.test.tsx`.
        - Description: Add/adjust tests asserting multiline instruction payload preserves newline characters.
        - Purpose: Preserve authored formatting.
     3. [ ] Whitespace-distinct messages are not merged in transcript hydration.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.turnHydration.test.tsx`.
        - Description: Add/adjust tests asserting messages that differ by whitespace remain distinct turns after hydration.
        - Purpose: Prevent normalization-based dedupe regressions.
     4. [ ] Whitespace-only input is blocked before run request dispatch.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.run.test.tsx`.
        - Description: Add/adjust tests asserting whitespace-only instruction does not trigger run request.
        - Purpose: Keep client guard aligned with server validation.
4. [ ] Extend existing Agents e2e coverage for raw-input outbound payload behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `e2e/agents.spec.ts` (new)
   - Explicit test subtasks (complete each separately):
     1. [ ] E2E: leading/trailing whitespace preserved in agents outbound payload.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions over captured request payload showing preserved surrounding whitespace.
        - Purpose: Validate real browser request behavior for agents.
     2. [ ] E2E: multiline newline structure preserved in agents outbound payload.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions for multiline payload byte-equivalence including newlines.
        - Purpose: Prevent newline-loss regressions in full flow.
     3. [ ] E2E: whitespace-only input does not dispatch agents run request.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions that whitespace-only submit attempts do not issue network request.
        - Purpose: Verify guard behavior in real UI execution.
5. [ ] Update `README.md` for Agents raw-input send behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document raw input preservation and whitespace-only guard behavior for Agents send path.
   - Purpose: Keep usage docs aligned with actual Agents input behavior.
6. [ ] Update `design.md` for Agents raw-input send flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document Agents send-flow behavior for raw payload preservation and validation boundaries.
   - Purpose: Keep design documentation accurate for future maintenance.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
8. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client -- agentsPage.run`
6. [ ] `npm run test --workspace client -- agentsPage.turnHydration`
7. [ ] `npm run e2e:test -- e2e/agents.spec.ts`
8. [ ] Manual smoke: Agents UI send multiline input with leading/trailing whitespace and verify outbound request preserves raw content while whitespace-only input is blocked
9. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 12. Client: Agents page user bubble markdown parity

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Render Agents user bubbles with the same markdown/sanitization component used by assistant bubbles, preserving existing bubble chrome/layout. This task is scoped to rendering parity and depends on Task 11 for raw-input send behavior.

#### Documentation Locations
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.)
- MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.)
- MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.)
- `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.)
- `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.)
- `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.)
- Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.)
- Jest docs (Context7): `/jestjs/jest` (Reason: authoritative Jest test runner/matcher/reference guidance for Agents markdown parity test updates.)
- Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)

#### Subtasks

1. [ ] Review current Agents user bubble rendering path and markdown component behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/Markdown.tsx`
2. [ ] Replace Agents user bubble `Typography` rendering with shared markdown renderer.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Constraints:
     - use `client/src/components/Markdown.tsx`
     - preserve current bubble container layout/chrome
3. [ ] Add Agents UI tests for markdown parity in both realtime and hydrated turns.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `client/src/test/agentsPage.run.test.tsx` (update existing if needed)
     - `client/src/test/agentsPage.turnHydration.test.tsx` (update existing if needed)
   - Explicit test subtasks (complete each separately):
     1. [ ] Agents user markdown rendering parity with assistant rendering.
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.run.test.tsx`, `client/src/test/agentsPage.turnHydration.test.tsx`.
        - Description: Add/adjust tests asserting user markdown (including mermaid fences) renders identically to assistant output in realtime and hydrated flows.
        - Purpose: Guarantee renderer parity in agents UI.
     2. [ ] Agents sanitization parity for unsafe HTML/scripts.
        - Test type: Client security regression.
        - Test location: `client/src/test/agentsPage.run.test.tsx`, `client/src/test/agentsPage.turnHydration.test.tsx`.
        - Description: Add/adjust tests with unsafe markup asserting sanitize behavior matches assistant renderer path.
        - Purpose: Prevent sanitization drift/XSS regressions.
     3. [ ] Agents malformed mermaid fallback parity.
        - Test type: Client resilience regression.
        - Test location: `client/src/test/agentsPage.run.test.tsx`, `client/src/test/agentsPage.turnHydration.test.tsx`.
        - Description: Add/adjust tests asserting malformed mermaid fences follow same safe fallback behavior as assistant path.
        - Purpose: Prevent render-break differences between roles.
4. [ ] Extend Agents e2e markdown parity coverage.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to add/edit:
     - `e2e/agents.spec.ts` (update existing from Task 11)
   - Explicit test subtasks (complete each separately):
     1. [ ] E2E: agents user markdown/mermaid rendering parity.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions that user markdown and mermaid output in Agents view matches assistant rendering behavior.
        - Purpose: Validate parity in browser runtime.
     2. [ ] E2E: malformed mermaid input in Agents view follows safe fallback behavior.
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions that invalid mermaid content does not break rendering and uses expected fallback.
        - Purpose: Validate resilience in full UI flow.
5. [ ] Update `README.md` for Agents user markdown parity behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document Agents user-bubble markdown parity behavior and rendering expectations.
   - Purpose: Keep developer/operator docs aligned with user-visible markdown behavior.
6. [ ] Update `design.md` for Agents user markdown parity flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document markdown-rendering component reuse and parity behavior for Agents user bubbles.
   - Purpose: Keep architecture notes and UI behavior contracts synchronized.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
8. [ ] Run lint/format checks for workspace.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Commands:
     - `npm run lint --workspaces`
     - `npm run format:check --workspaces`

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client -- agentsPage.run`
6. [ ] `npm run test --workspace client -- agentsPage.turnHydration`
7. [ ] `npm run test --workspace client -- agentsPage.descriptionPopover`
8. [ ] `npm run e2e:test -- e2e/agents.spec.ts`
9. [ ] Manual smoke: Agents UI send multiline markdown and verify user bubble formatting parity
10. [ ] `npm run compose:down`

#### Implementation notes

- to_do

---

### 13. Final verification: acceptance check, full regressions, and documentation normalization

- Task Status: **__to_do__**
- Git Commits: to_do

#### Overview

Validate every acceptance criterion end-to-end after all feature tasks are complete, run full regression layers (Jest, Cucumber, e2e), and finish all documentation and PR summary output.

#### Documentation Locations
- External docs only: this section must never include repository file paths; keep codebase files under the relevant subtask `Files to read` / `Files to edit` bullets.

- Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.)
- Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.)
- Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.)
- Cucumber guides index: https://cucumber.io/docs/guides/ (Reason: required top-level cucumber guides reference for cucumber-related final verification.)
- Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.)
- Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.)
- Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)

#### Subtasks

1. [ ] Re-check all acceptance criteria against implemented behavior and mark any gap before final testing.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to read:
     - `planning/0000035-mcp-keepalive-defaults-reingest-and-chat-rendering.md`
2. [ ] Update `README.md` with final verified story behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Apply final documentation updates for user-facing behavior and commands verified by regression runs.
   - Purpose: Ensure final delivery documentation is accurate and complete.
3. [ ] Update `design.md` with final verified behavior and diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Apply final architecture notes and Mermaid diagram updates that match implemented behavior.
   - Purpose: Keep design documentation authoritative at story completion.
4. [ ] Prepare manual verification artifacts in `test-results/screenshots/` with naming `0000035-13-<label>.png`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
5. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after screenshot files are prepared).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Files to edit:
     - `projectStructure.md`
6. [ ] Create a PR summary comment covering all task outcomes, contract changes, and verification evidence.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.

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
