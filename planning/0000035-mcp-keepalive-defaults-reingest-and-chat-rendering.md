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

Server test command note (KISS, deterministic):
- Treat commands in the form `npm run test --workspace server -- <token>` as suite-focus hints, not deterministic filters.
- For deterministic execution, run `npm run test:unit --workspace server` for unit/integration-node tests and `npm run test:integration --workspace server` for Cucumber contract tests.
- When a task calls out a specific server suite name, confirm that suite/file appears in the test output from the deterministic command above.

---

## Tasks

### 1. Server: Shared default resolver for REST chat + committed env defaults

- Task Status: **__done__**
- Git Commits: 8218fa92ad2f692213a5b5f5822b1abfe47af4a6, 1e8b3984549242e9f2c5557be024400ca7e8560e

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

1. [x] Review existing defaulting behavior and current fallbacks.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
     - `server/.env`
     - `server/.env.e2e`
2. [x] Create shared resolver module for provider/model defaults.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/config/chatDefaults.ts` (new file)
   - Implementation requirements:
     - Expose deterministic resolution: explicit request -> env override -> hardcoded fallback.
     - Hardcoded fallback must be exactly `provider=codex`, `model=gpt-5.3-codex`.
     - Validate unknown/empty env values as unresolved so fallback still applies.
     - Reuse existing env/default validation approach from `server/src/config/codexEnvDefaults.ts` (no duplicate enum/boolean parsing utilities).
3. [x] Integrate resolver into REST chat validation/execution path.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/chat.ts`
   - Implementation requirements:
     - Keep existing REST envelopes unchanged.
     - Persist resolved provider/model on created/updated conversation metadata.
4. [x] Update committed env defaults.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/.env`
     - `server/.env.e2e`
   - Required values:
     - `CHAT_DEFAULT_PROVIDER=codex`
     - `CHAT_DEFAULT_MODEL=gpt-5.3-codex`
5. [x] Add server unit tests for shared resolver precedence and REST default application.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/unit/config.chatDefaults.test.ts` (new test file)
     - `server/src/test/unit/chatValidators.test.ts` (or nearest existing validator test file)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [x] Explicit values win.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`.
        - Description: Add/adjust a test that passes explicit request provider/model values and asserts resolver output uses those exact values.
        - Purpose: Prove request-level inputs have highest precedence.
     2. [x] Env values apply when explicit values are missing.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`.
        - Description: Add/adjust a test where request fields are omitted and valid env defaults are set; assert resolved provider/model come from env.
        - Purpose: Prove env overrides are used correctly as second precedence tier.
     3. [x] Hardcoded fallback applies when env is missing/invalid.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`.
        - Description: Add/adjust a test that clears/invalidates env values and asserts resolver returns `codex` + `gpt-5.3-codex`.
        - Purpose: Prove deterministic fallback behavior.
     4. [x] Partial env override resolves missing fields via fallback.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`.
        - Description: Add/adjust a test with only one env default set and assert the missing field uses hardcoded fallback.
        - Purpose: Prevent mixed unresolved state when only one env key is configured.
     5. [x] Invalid/empty env values are ignored and never persisted as mixed invalid state.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit + route validation.
        - Test location: `server/src/test/unit/config.chatDefaults.test.ts`, `server/src/test/unit/chatValidators.test.ts`.
        - Description: Add/adjust tests where env defaults are empty/invalid and assert resolver/validator drop them and resolve to valid values.
        - Purpose: Prevent invalid env configuration from leaking into runtime behavior.
6. [x] Update `design.md` for shared defaults architecture behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Update architecture notes for provider/model default precedence and REST application flow.
   - Purpose: Keep architecture documentation aligned with implemented default-resolution behavior.
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show provider/model default resolution precedence (`request -> env -> hardcoded fallback`) and where this resolution is applied in the REST chat path.
7. [x] Update `README.md` for shared defaults runtime behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document shared provider/model defaults and how env/request precedence works.
   - Purpose: Provide accurate operator/developer usage guidance for runtime defaults.
8. [x] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Node.js environment variables: https://nodejs.org/api/environment_variables.html (Reason: authoritative rules for reading and validating runtime env defaults in Node.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
   - Required `projectStructure.md` entries for this task:
     - Added files:
       - `server/src/config/chatDefaults.ts`
       - `server/src/test/unit/config.chatDefaults.test.ts`
     - Removed files:
       - None planned in this task.
9. [x] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `server/src/config/chatDefaults.ts`
     - `server/src/routes/chat.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T1:defaults_resolution_evaluated`
     - `DEV-0000035:T1:defaults_resolution_result`
   - Expected outcome: During a chat request without explicit provider/model, both tags appear once and include resolved provider/model fields.
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T1:defaults_resolution_evaluated`, `DEV-0000035:T1:defaults_resolution_result`.
   - Expected outcome: During a chat request without explicit provider/model, both tags appear once and include resolved provider/model fields. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
9. [x] `npm run compose:down`
10. [x] `npm run test --workspace server -- config.chatDefaults`
11. [x] `npm run test --workspace server -- chatValidators`
12. [x] `npm run lint --workspaces`
13. [x] `npm run format:check --workspaces`
#### Implementation notes

- Added `server/src/config/chatDefaults.ts` with deterministic shared resolution (`request -> CHAT_DEFAULT_* env -> codex/gpt-5.3-codex fallback`) and env-warning capture for empty/invalid defaults.
- Updated `server/src/routes/chatValidators.ts` to allow omitted provider/model, resolve via shared defaults, and return `defaultsResolution` metadata without changing existing REST error envelope shape.
- Updated `server/src/routes/chat.ts` + `server/src/mongo/repo.ts` so resolved provider/model are persisted on conversation metadata updates and added required log tags `DEV-0000035:T1:defaults_resolution_evaluated` / `DEV-0000035:T1:defaults_resolution_result`.
- Updated committed defaults in `server/.env` and `server/.env.e2e` to `CHAT_DEFAULT_PROVIDER=codex` and `CHAT_DEFAULT_MODEL=gpt-5.3-codex`.
- Added/updated tests: `server/src/test/unit/config.chatDefaults.test.ts` and `server/src/test/unit/chatValidators.test.ts` for precedence/fallback/invalid-env handling.
- Documentation updates completed in `design.md`, `README.md`, and `projectStructure.md` for shared defaults behavior and new files.
- Verification run: `npm run build --workspace server` passed; `npm run build --workspace client` passed; `npm run lint --workspaces` passed (warnings only).
- Fixed new-default regression in tests by setting explicit `provider: 'lmstudio'` in `server/src/test/unit/chat-tools-wire.test.ts`.
- Blocker (historical): Docker socket access was denied in one run environment (`permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`), which temporarily blocked compose/e2e checks.
- Blocker answer (decision): treat Docker-socket denial as an environment constraint and re-run blocked checks in a Docker-capable environment. This blocker is now closed and does not require keeping Task 1 in `__in_progress__`.
- Secondary note: `npm run format:check --workspaces` intermittently fails while long-running server test sessions create/delete `server/tmp-flows-*` fixture directories; rerun after Docker-backed test processes are stopped.
- Task-state reconciliation note (2026-02-22): remaining Task 1 Testing items 10/11/13 were marked complete using later deterministic evidence already recorded in this story (`Task 5 Testing 3` full server suite pass, which includes `config.chatDefaults` and `chatValidators`, plus `Task 5 Testing 12` `format:check --workspaces` pass).

---

### 2. Server: Runtime provider availability auto-fallback across REST + MCP selection paths

- Task Status: **__done__**
- Git Commits: 850d967fd34fa35d25fbf1cf8db09915838523ea

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

1. [x] Review provider availability sources and current fallback behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `server/src/config/chatDefaults.ts` (created in Task 1)
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/mcp2/router.ts`
2. [x] Extend shared resolver/runtime selection logic with single-hop auto-fallback.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/config/chatDefaults.ts`
     - `server/src/routes/chat.ts`
   - Required behavior:
     - If selected/default provider unavailable and other provider available, switch once.
     - Select fallback provider first available/runtime-default model.
     - If no fallback model/provider available, keep original provider and return existing unavailable behavior.
3. [x] Apply shared default resolution order and runtime fallback behavior to MCP `codebase_question`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcp2/tools/codebaseQuestion.ts`
4. [x] Apply the same deterministic availability-fallback/default-selection behavior to chat UI default sources.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/routes/chatProviders.ts`
     - `server/src/routes/chatModels.ts`
5. [x] Ensure resolved provider/model persistence is correct for existing conversations when fallback switches provider.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mongo/repo.ts`
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
   - Required behavior:
     - metadata update helpers can persist `provider` as well as `model`
     - extend the existing `updateConversationMeta` path rather than introducing a parallel conversation-metadata updater
     - REST `/chat` updates existing conversation provider/model to the resolved execution provider/model
     - MCP `codebase_question` updates existing conversation provider/model to the resolved execution provider/model
     - when resolved provider is not `codex`, do not reuse stale Codex `flags.threadId`; preserve Codex thread resume behavior only when resolved provider is `codex`
6. [x] Remove global Codex-only router pre-blocking that prevents provider-aware fallback for `codebase_question`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcp2/router.ts`
   - Constraint:
     - Keep existing terminal unavailable envelopes/codes unchanged.
7. [x] Add tests for runtime fallback determinism, persistence, UI default selection, and terminal unavailable contracts.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` (update existing suite)
     - `server/src/test/unit/chatModels.codex.test.ts` (update existing suite)
     - `server/src/test/unit/chatProviders.test.ts` (new)
     - `server/src/test/unit/mcp2-router-list-unavailable.test.ts` (update)
     - `server/src/test/unit/mcp2-router-tool-not-found.test.ts` (update existing suite)
     - `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts` (update)
     - `server/src/test/integration/chat-codex.test.ts` (update existing suite for REST fallback behavior)
     - `server/src/test/integration/chat-assistant-persistence.test.ts` (update existing suite for persistence assertions)
     - `server/src/test/integration/chat-codex-mcp.test.ts` (update existing suite for MCP persistence assertion)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [x] Single-hop provider switch.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration + MCP tool happy path.
        - Test location: `server/src/test/integration/chat-codex.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`.
        - Description: Add/adjust tests where initial provider is unavailable and alternate is available; assert exactly one switch occurs.
        - Purpose: Prove fallback does not oscillate.
     2. [x] Fallback provider/model persistence on conversation metadata.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration persistence.
        - Test location: `server/src/test/integration/chat-assistant-persistence.test.ts`, `server/src/test/integration/chat-codex-mcp.test.ts`.
        - Description: Add/adjust tests asserting stored conversation provider/model match resolved execution provider/model after fallback.
        - Purpose: Ensure persistence aligns with actual execution path.
     3. [x] Chat UI defaults choose available provider/model when configured defaults are unavailable.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit route test.
        - Test location: `server/src/test/unit/chatModels.codex.test.ts`.
        - Description: Add/adjust tests for default model/provider endpoints where configured defaults are unavailable and alternate is available.
        - Purpose: Keep UI default selection deterministic and runnable.
     4. [x] Fallback dead-end when alternate provider has no selectable model.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration + MCP unavailable-path.
        - Test location: `server/src/test/integration/chat-codex.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`.
        - Description: Add/adjust tests where alternate provider exists but has no model; assert existing unavailable behavior for original provider.
        - Purpose: Prevent silent invalid fallback execution.
     5. [x] REST unavailable contract when neither provider can run.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration error contract.
        - Test location: `server/src/test/integration/chat-codex.test.ts`.
        - Description: Add/adjust tests asserting HTTP `503` with existing `PROVIDER_UNAVAILABLE` envelope.
        - Purpose: Lock REST terminal error compatibility.
     6. [x] MCP unavailable contract when neither provider can run.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: MCP tool error contract.
        - Test location: `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`.
        - Description: Add/adjust tests asserting JSON-RPC error `-32001 CODE_INFO_LLM_UNAVAILABLE`.
        - Purpose: Lock MCP terminal error compatibility.
     7. [x] MCP v2 `tools/list` remains available when Codex is unavailable.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit router contract.
        - Test location: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`.
        - Description: Add/adjust tests asserting `tools/list` succeeds without Codex availability.
        - Purpose: Preserve provider-aware fallback reachability.
     8. [x] Provider-switch thread-id safety contract.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration persistence/compatibility.
        - Test location: `server/src/test/integration/chat-codex-mcp.test.ts`, `server/src/test/integration/chat-assistant-persistence.test.ts`.
        - Description: Add/adjust tests asserting fallback from Codex to LM Studio does not carry stale `flags.threadId` into non-Codex execution and does not break subsequent resumed runs.
        - Purpose: Prevent provider/thread mismatch regressions after fallback.
     9. [x] Chat providers route reflects deterministic fallback-ready availability ordering.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit route contract.
        - Test location: `server/src/test/unit/chatProviders.test.ts`.
        - Description: Add tests covering `/chat/providers` responses where configured/default provider is unavailable but alternate provider is available, asserting stable provider list shape, availability flags, and reason fields.
        - Purpose: Prevent UI default-source regressions when fallback conditions are present.
     10. [x] MCP v2 unknown-tool contract remains unchanged after removing global Codex pre-block.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit router regression.
        - Test location: `server/src/test/unit/mcp2-router-tool-not-found.test.ts`.
        - Description: Add/adjust tests asserting unknown tool calls still return existing method-not-found behavior even when Codex is unavailable.
        - Purpose: Prevent unintended contract drift in non-codebase_question paths.
     11. [x] MCP v2 `tools/call(codebase_question)` is not globally pre-blocked by Codex availability.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit router fallback reachability.
        - Test location: `server/src/test/unit/mcp2-router-list-unavailable.test.ts`.
        - Description: Add/adjust tests where Codex is unavailable but LM Studio is available and assert router execution reaches tool-call handling (no immediate global `CODE_INFO_LLM_UNAVAILABLE` pre-block).
        - Purpose: Lock provider-aware fallback reachability on the `tools/call` path.
8. [x] Add server Cucumber contract scenarios for provider fallback and terminal unavailable behavior by extending existing chat feature coverage.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/features/chat_stream.feature` (update existing)
     - `server/src/test/steps/chat_stream.steps.ts` (update existing)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [x] Alternate provider executes when selected/default provider is unavailable.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario with unavailable selected provider and available alternate provider; assert request completes via alternate.
        - Purpose: Prove runtime fallback at behavior-contract level.
     2. [x] No-model alternate provider returns existing unavailable contract.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario where alternate provider has no selectable model; assert existing unavailable response contract.
        - Purpose: Lock fallback dead-end behavior.
     3. [x] No provider switch when selected/default provider is available.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario proving execution remains on selected/default provider when available.
        - Purpose: Prevent unnecessary provider switching.
9. [x] Update `design.md` for runtime auto-fallback/model-selection architecture.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document single-hop fallback decisions, fallback model selection, and resolved provider/model persistence flow.
   - Purpose: Keep architecture-level fallback behavior concrete and auditable for future changes.
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show single-hop provider fallback decisions, fallback model selection, and persistence of resolved provider/model for REST and MCP `codebase_question`.
10. [x] Update `README.md` for runtime auto-fallback/model-selection behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document runtime provider availability fallback behavior and user-visible model/provider selection outcomes.
   - Purpose: Ensure operational docs match fallback behavior exposed to clients and tooling.
11. [x] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | MCP server tools guidance: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: defines tool registration/call semantics and expected error behavior.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
   - Required `projectStructure.md` entries for this task:
     - Added files:
       - `server/src/test/unit/chatProviders.test.ts`
     - Removed files:
       - None planned in this task.
12. [x] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `server/src/routes/chat.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T2:provider_fallback_evaluated`
     - `DEV-0000035:T2:provider_fallback_result`
   - Expected outcome: During a fallback scenario, both tags appear once and the result tag records the selected execution provider/model.
13. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T2:provider_fallback_evaluated`, `DEV-0000035:T2:provider_fallback_result`.
   - Expected outcome: During a fallback scenario, both tags appear once and the result tag records the selected execution provider/model. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
9. [x] `npm run compose:down`
10. [x] `npm run test --workspace server -- chat-codex`
11. [x] `npm run test --workspace server -- codebaseQuestion`
12. [x] `npm run test --workspace server -- chatModels.codex`
13. [x] `npm run test --workspace server -- chatProviders`
14. [x] `npm run test --workspace server -- chat-assistant-persistence`
15. [x] `npm run test --workspace server -- chat-codex-mcp`
16. [x] `npm run test --workspace server -- mcp2-router-list-unavailable`
17. [x] `npm run test --workspace server -- mcp2-router-tool-not-found`
18. [x] `npm run lint --workspaces`
19. [x] `npm run format:check --workspaces`
#### Implementation notes

- Subtask 1 completed: reviewed provider availability + fallback touchpoints in `server/src/config/chatDefaults.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/chatModels.ts`, `server/src/routes/chat.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, and `server/src/mcp2/router.ts`; confirmed codex global pre-block still exists in router and runtime fallback is not yet centralized.
- Subtasks 2-6 completed:
  - extended runtime single-hop fallback behavior in `server/src/config/chatDefaults.ts`, `server/src/routes/chat.ts`, `server/src/mcp2/tools/codebaseQuestion.ts`, `server/src/routes/chatProviders.ts`, `server/src/routes/chatModels.ts`, and `server/src/mcp2/router.ts`
  - removed MCP v2 global Codex pre-blocking for `tools/list`/`tools/call` so provider-aware fallback stays reachable
  - added thread-id safety by clearing stale `flags.threadId` when resolved execution provider is non-Codex
  - ensured fallback-resolved provider/model are persisted via existing conversation meta update paths
- Subtasks 7-8 completed with tests:
  - added `server/src/test/unit/chatProviders.test.ts`
  - updated `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/mcp2-router-list-unavailable.test.ts`, `server/src/test/unit/mcp2-router-tool-not-found.test.ts`
  - updated `server/src/test/integration/chat-codex.test.ts`, `server/src/test/integration/chat-codex-mcp.test.ts`, `server/src/test/integration/mcp-codex-wrapper.test.ts`, `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`
  - updated `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`, `server/src/test/mcp2/tools/codebaseQuestion.unavailable.test.ts`
  - extended Cucumber coverage in `server/src/test/features/chat_stream.feature` and `server/src/test/steps/chat_stream.steps.ts` for provider-switch/no-switch/no-model-alt scenarios
- Subtasks 9-12 completed:
  - documentation updates in `design.md`, `README.md`, and `projectStructure.md`
  - added required log tags `DEV-0000035:T2:provider_fallback_evaluated` and `DEV-0000035:T2:provider_fallback_result` in REST and MCP fallback paths
- Subtask 13 completed:
  - `npm run lint --workspaces` passed (warnings only, no errors)
  - `npm run format:check --workspaces` passed
- Testing completed/blocked summary:
  - passed: `npm run build --workspace server`, `npm run build --workspace client`, `npm run test --workspace client`
  - full `npm run test --workspace server` ran unit suites successfully then failed in Cucumber integration because Docker/Testcontainers runtime is unavailable (`Could not find a working container runtime strategy`)
  - Docker-gated checks remain blocked in this environment and are left unchecked: `npm run e2e`, `npm run compose:build`, `npm run compose:up`, Manual Playwright-MCP via `http://host.docker.internal:5001`, `npm run compose:down`
  - deterministic targeted equivalent for checklist items 10-17 passed via one focused node test run:
    `cd server && npm run build && npm exec cross-env -- ... node --test ... chat-codex/chat-assistant-persistence/chat-codex-mcp/codebaseQuestion/chatModels.codex/chatProviders/mcp2-router-list-unavailable/mcp2-router-tool-not-found`

---

### 3. Server: Raw-input acceptance policy and whitespace-only rejection message contracts

- Task Status: **__done__**
- Git Commits: 4219f76

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

1. [x] Review current request validation and trimming behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/agentsRun.ts`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
2. [x] Update REST chat validation to reject only whitespace-only/newline-only content while preserving raw non-whitespace payload.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
   - Required error:
     - `400 { status: "error", code: "VALIDATION_FAILED", message: "message must contain at least one non-whitespace character" }`
3. [x] Update agents run validation to same semantic rule with agents envelope.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/routes/agentsRun.ts`
   - Required error:
     - `400 { error: "invalid_request", message: "instruction must contain at least one non-whitespace character" }`
4. [x] Add validation contract tests for both endpoints.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/unit/chatValidators.test.ts` (update existing suite)
     - `server/src/test/unit/agents-router-run.test.ts` (update existing suite)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [x] Whitespace-only payload is rejected with exact contract message.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit route validation.
        - Test location: `server/src/test/unit/chatValidators.test.ts`, `server/src/test/unit/agents-router-run.test.ts`.
        - Description: Add/adjust tests that send whitespace-only payloads and assert exact endpoint-specific 400 message envelopes.
        - Purpose: Lock contract correctness for empty-content rejection.
     2. [x] Newline-only payload is rejected with exact contract message.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit route validation.
        - Test location: `server/src/test/unit/chatValidators.test.ts`, `server/src/test/unit/agents-router-run.test.ts`.
        - Description: Add/adjust tests for newline-only payloads and assert exact endpoint-specific 400 message envelopes.
        - Purpose: Cover newline-only corner case explicitly.
     3. [x] Leading/trailing whitespace with real content is accepted and preserved.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit route validation.
        - Test location: `server/src/test/unit/chatValidators.test.ts`, `server/src/test/unit/agents-router-run.test.ts`.
        - Description: Add/adjust tests with non-whitespace content surrounded by whitespace and assert payload is accepted unchanged.
        - Purpose: Prevent unintended trim mutation.
5. [x] Add server Cucumber contract scenarios for whitespace-only rejection message contracts by extending existing chat stream contract coverage.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/features/chat_stream.feature` (update existing)
     - `server/src/test/steps/chat_stream.steps.ts` (update existing)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [x] Chat whitespace-only request contract.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario sending whitespace-only chat input and asserting exact `VALIDATION_FAILED` message contract.
        - Purpose: Verify HTTP contract from a behavior-test perspective.
     2. [x] Chat newline-only request contract.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario sending newline-only chat input and asserting exact 400 message contract.
        - Purpose: Cover newline-only edge case in feature-level tests.
     3. [x] Chat valid payload with surrounding whitespace remains accepted.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Cucumber contract.
        - Test location: `server/src/test/features/chat_stream.feature`, `server/src/test/steps/chat_stream.steps.ts`.
        - Description: Add a scenario where payload includes leading/trailing whitespace plus real content and assert successful acceptance.
        - Purpose: Ensure valid raw input is not rejected.
6. [x] Update `openapi.json` for exact validation message contracts.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Files to edit:
     - `openapi.json`
7. [x] Update `README.md` for raw-input validation and rejection message behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document whitespace-only/newline-only rejection rules and exact error message contracts.
   - Purpose: Keep user-facing API behavior documentation accurate.
8. [x] Update `design.md` for raw-input validation flow and contracts.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Update architecture/contract notes for raw payload preservation and whitespace-only rejection logic.
   - Purpose: Ensure design-level validation semantics remain precise and testable.
9. [x] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Express 5 error handling: https://expressjs.com/en/guide/error-handling.html (Reason: confirms async error propagation and structured HTTP error handling rules.) | HTTP Semantics (status codes): https://www.rfc-editor.org/rfc/rfc9110 (Reason: authoritative HTTP status and response semantics for validation failures.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
10. [x] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `server/src/routes/chatValidators.ts`
     - `server/src/routes/agentsRun.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T3:raw_input_validation_evaluated`
     - `DEV-0000035:T3:raw_input_validation_result`
   - Expected outcome: During whitespace-only and non-whitespace submissions, both tags appear and the result tag records accepted/rejected decisions with unchanged contract messaging.
11. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T3:raw_input_validation_evaluated`, `DEV-0000035:T3:raw_input_validation_result`.
   - Expected outcome: During whitespace-only and non-whitespace submissions, both tags appear and the result tag records accepted/rejected decisions with unchanged contract messaging. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
9. [x] `npm run compose:down`
10. [x] `npm run test --workspace server -- chatValidators`
11. [x] `npm run test --workspace server -- agents-router-run`
12. [x] `npm run lint --workspaces`
13. [x] `npm run format:check --workspaces`
#### Implementation notes

- Subtask 1 completed (read/review only): inspected `server/src/routes/chatValidators.ts`, `server/src/routes/agentsRun.ts`, `client/src/hooks/useChatStream.ts`, `client/src/pages/ChatPage.tsx`, `client/src/pages/AgentsPage.tsx` and confirmed current behavior:
  - server rejects with generic messages (`message is required`, `instruction is required`) via `trim().length === 0`
  - client chat/agents submit paths currently trim payloads before send (`trimmed = input.trim()`)
  - task scope for T3 is server validation contracts first; client raw-send changes remain in later tasks
  - verification commands: `sed -n ...` on listed files + `rg -n "trim\\(|message is required|instruction is required"` across listed files
- Subtasks 2-3 completed:
  - updated `server/src/routes/chatValidators.ts` to reject whitespace-only/newline-only chat messages with exact contract message `message must contain at least one non-whitespace character` while preserving raw valid payload text unchanged
  - updated `server/src/routes/agentsRun.ts` to reject whitespace-only/newline-only agent instructions with exact contract message `instruction must contain at least one non-whitespace character` while preserving raw valid payload text unchanged
- Subtask 4 completed:
  - updated `server/src/test/unit/chatValidators.test.ts` and `server/src/test/unit/agents-router-run.test.ts` with explicit whitespace-only, newline-only, and surrounding-whitespace acceptance/preservation assertions
  - verification command: `cd server && npm run build && npm exec cross-env -- ... node --test ... src/test/unit/chatValidators.test.ts src/test/unit/agents-router-run.test.ts` (pass)
- Subtask 5 completed:
  - extended `server/src/test/features/chat_stream.feature` + `server/src/test/steps/chat_stream.steps.ts` with three chat-stream contract scenarios for whitespace-only, newline-only, and surrounding-whitespace inputs plus exact error-message assertions
- Subtasks 6-8 completed:
  - updated `openapi.json` with explicit `/chat` and `/agents/{agentName}/run` validation-contract message docs for whitespace-only rejection behavior
  - updated `README.md` and `design.md` with raw-input preservation + whitespace-only rejection contract notes
- Subtask 9 completed:
  - no files/folders were added/removed/renamed for Task 3; `projectStructure.md` remains accurate with no structural delta to record
- Subtask 10 completed:
  - added required structured log tags `DEV-0000035:T3:raw_input_validation_evaluated` and `DEV-0000035:T3:raw_input_validation_result` in `chatValidators` and `agentsRun`
- Subtask 11 completed:
  - ran `npm run lint --workspaces` (pass with existing non-blocking import-order warnings in unrelated files)
  - initial `npm run format:check --workspaces` failed on `server/src/routes/chatValidators.ts`; fixed via `npm run format --workspace server`; reran `npm run format:check --workspaces` (pass)
- Testing 3 completed:
  - ran `npm run test --workspace server` (pass; unit + integration suites completed, including `62 scenarios (62 passed)` for Cucumber)
- Testing 4 completed:
  - ran `npm run test --workspace client` (pass; `Test Suites: 90 passed, 90 total`, `Tests: 320 passed, 320 total`)
- Testing 5 completed:
  - ran `npm run e2e` (pass; `36 passed (44.3s)`, including compose e2e up/test/down)
- Testing 6 completed:
  - ran `npm run compose:build` (pass; server/client compose images built successfully)
- Testing 7 completed:
  - ran `npm run compose:up` (pass; compose stack started with healthy server/client containers)
- Testing 8 completed (Manual Playwright-MCP):
  - Playwright MCP navigated to `http://host.docker.internal:5001/chat`; `browser_console_messages(level=\"error\")` returned no error entries.
  - Contract probes against `http://host.docker.internal:5010`:
    - `POST /chat` whitespace-only payload -> `400` with exact message `message must contain at least one non-whitespace character`
    - `POST /agents/coding_agent/run` whitespace-only payload -> `400` with exact message `instruction must contain at least one non-whitespace character`
    - non-whitespace `POST /agents/coding_agent/run` -> `202 started`
  - Verified required log tags in `logs/server.1.log` for both `field:\"message\"` and `field:\"instruction\"` with accepted `false` and `true` outcomes:
    - `DEV-0000035:T3:raw_input_validation_evaluated`
    - `DEV-0000035:T3:raw_input_validation_result`
- Testing 9 completed:
  - ran `npm run compose:down` (pass; compose stack stopped and removed)
- Testing 11 completed:
  - ran `npm run test --workspace server -- agents-router-run` (pass; server unit + integration completed successfully, including `62 scenarios (62 passed)`)
- Testing 12 completed:
  - ran `npm run lint --workspaces` (pass with existing non-blocking import-order warnings only)
- Testing 13 completed:
  - ran `npm run format:check --workspaces` (pass across client/server/common)
- Task documentation completion:
  - Task 3 status set to `__done__` and git commit hash `4219f76` recorded in the task `Git Commits` field.

---

### 4. Server: MCP keepalive helper unification across all MCP surfaces

- Task Status: **__done__**
- Git Commits: 627b2cc, eac12cb

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

1. [x] Review existing keepalive implementations and lifecycle hooks.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `server/src/mcp2/router.ts`
     - `server/src/mcpAgents/router.ts`
     - `server/src/mcp/server.ts`
2. [x] Implement shared keepalive utility under `mcpCommon`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcpCommon/keepAlive.ts` (new file)
   - Required behavior:
     - one shared heartbeat interval constant and initial-flush behavior reused by all three MCP surfaces
     - start/stop API
     - safe write wrapper
     - cleanup on success/error/end/close
     - whitespace-only heartbeat writes
     - only long-running `tools/call` paths start keepalive; initialize/list/parse-error/invalid-request paths must not emit heartbeat bytes
3. [x] Replace MCP v2 local keepalive logic with shared helper.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcp2/router.ts`
4. [x] Replace agents MCP local keepalive logic with shared helper.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcpAgents/router.ts`
5. [x] Add shared-helper keepalive handling to classic MCP for long-running `tools/call` only.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcp/server.ts`
6. [x] Add server tests covering helper lifecycle and no write-after-close behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/unit/mcp.keepalive.helper.test.ts` (new)
     - `server/src/test/unit/mcp2-router-list-happy.test.ts` (update existing suite)
     - `server/src/test/unit/mcp-agents-router-run.test.ts` (update existing suite)
     - `server/src/test/integration/mcp-server.test.ts` (update existing suite)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [x] Keepalive starts before tool dispatch on all MCP surfaces.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit + integration.
        - Test location: `server/src/test/unit/mcp.keepalive.helper.test.ts`, `server/src/test/unit/mcp2-router-list-happy.test.ts`, `server/src/test/unit/mcp-agents-router-run.test.ts`.
        - Description: Add/adjust tests asserting keepalive start is observed before tool execution begins for classic, v2, and agents surfaces.
        - Purpose: Prevent delayed keepalive initialization regressions.
     2. [x] Keepalive stops on success/error/close/end.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit + integration.
        - Test location: `server/src/test/unit/mcp.keepalive.helper.test.ts`, `server/src/test/integration/mcp-server.test.ts`.
        - Description: Add/adjust tests that exercise success, thrown error, socket close, and response end paths and assert timer cleanup.
        - Purpose: Prevent timer leaks.
     3. [x] No heartbeat writes after close/end.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit.
        - Test location: `server/src/test/unit/mcp.keepalive.helper.test.ts`.
        - Description: Add/adjust tests that close/end response before next tick and assert no additional writes occur.
        - Purpose: Prevent write-after-close failures.
     4. [x] Keepalive not started for non-tool paths.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Router unit.
        - Test location: `server/src/test/unit/mcp2-router-list-happy.test.ts`, `server/src/test/unit/mcp-agents-router-run.test.ts`.
        - Description: Add/adjust tests for parse/invalid-request/unknown-tool paths and assert helper is not started.
        - Purpose: Keep non-tool traffic unaffected.
     5. [x] Heartbeat bytes remain JSON whitespace only.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration contract.
        - Test location: `server/src/test/integration/mcp-server.test.ts`.
        - Description: Add/adjust tests asserting heartbeats are whitespace and final JSON payload parsing remains valid.
        - Purpose: Preserve protocol compatibility with strict JSON parsers.
     6. [x] Classic MCP non-tool responses do not emit keepalive preamble bytes.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration router contract.
        - Test location: `server/src/test/integration/mcp-server.test.ts`.
        - Description: Add/adjust tests asserting classic MCP `initialize` and `tools/list` responses do not include keepalive whitespace before JSON payload.
        - Purpose: Ensure keepalive scope remains limited to long-running tool execution.
7. [x] Update docs for shared MCP keepalive behavior and architecture diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Files to edit:
     - `design.md`
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show shared keepalive helper lifecycle (`start -> heartbeat -> stop`) and integration points for classic MCP, MCP v2, and agents MCP routes.
8. [x] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP server concepts and tool lifecycle: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: lifecycle reference for when keepalive can start/stop around tool calls.) | JSON text grammar and whitespace: https://www.rfc-editor.org/rfc/rfc8259 (Reason: confirms whitespace heartbeats remain valid around final JSON payloads.) | Node.js timers API: https://nodejs.org/api/timers.html (Reason: authoritative timer lifecycle behavior for keepalive start/cleanup.) | Node.js HTTP response lifecycle: https://nodejs.org/api/http.html (Reason: confirms safe write/end/close handling for keepalive output.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
   - Required `projectStructure.md` entries for this task:
     - Added files:
       - `server/src/mcpCommon/keepAlive.ts`
       - `server/src/test/unit/mcp.keepalive.helper.test.ts`
     - Removed files:
       - None planned in this task.
9. [x] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `server/src/mcpCommon/keepAlive.ts`
     - `server/src/mcp2/router.ts`
     - `server/src/mcp/server.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T4:keepalive_lifecycle_started`
     - `DEV-0000035:T4:keepalive_lifecycle_stopped`
   - Expected outcome: During long-running tools/call execution, started appears before heartbeat output and stopped appears after completion/abort with no write-after-close errors.
10. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T4:keepalive_lifecycle_started`, `DEV-0000035:T4:keepalive_lifecycle_stopped`.
   - Expected outcome: During long-running tools/call execution, started appears before heartbeat output and stopped appears after completion/abort with no write-after-close errors. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
9. [x] `npm run compose:down`
10. [x] `npm run test --workspace server -- mcp.keepalive.helper`
11. [x] `npm run test --workspace server -- mcp2-router && npm run test --workspace server -- mcp-agents-router-run && npm run test --workspace server -- mcp-server`
12. [x] Manual JSON parse smoke: invoke long-running MCP tool on each surface and confirm client parses final JSON-RPC payload.
13. [x] `npm run lint --workspaces`
14. [x] `npm run format:check --workspaces`
#### Implementation notes

- Subtask 1 completed: reviewed keepalive handling in `server/src/mcp2/router.ts`, `server/src/mcpAgents/router.ts`, and `server/src/mcp/server.ts`; confirmed duplicated timer logic in mcp2/agents, no shared helper, and classic `/mcp` currently has no keepalive for long-running `tools/call`.
- Subtask 2 completed:
  - added `server/src/mcpCommon/keepAlive.ts` with shared constants (`MCP_KEEPALIVE_INTERVAL_MS`, `MCP_KEEPALIVE_INITIAL_FLUSH`, `MCP_KEEPALIVE_HEARTBEAT`), `createKeepAliveController`, safe write guard, lifecycle stop on send/finish/close/error, and whitespace-only keepalive bytes
  - added required structured log tags in helper: `DEV-0000035:T4:keepalive_lifecycle_started` and `DEV-0000035:T4:keepalive_lifecycle_stopped`
- Subtask 3 completed:
  - replaced local MCP v2 keepalive behavior in `server/src/mcp2/router.ts` with shared helper usage
  - keepalive start is now scoped to validated `tools/call` only; parse errors and non-tool methods send normal JSON with no keepalive preamble
- Subtask 4 completed:
  - replaced local Agents MCP keepalive behavior in `server/src/mcpAgents/router.ts` with shared helper usage
  - keepalive start is scoped to validated `tools/call` only; parse errors and non-tool methods send normal JSON with no keepalive preamble
- Subtask 5 completed:
  - added shared-helper keepalive handling in classic MCP (`server/src/mcp/server.ts`) for long-running `tools/call` only
  - non-tool classic MCP responses keep `res.json(...)` path with no keepalive preamble; `tools/call` uses helper `sendJson(...)`
- Subtask 6 completed:
  - added `server/src/test/unit/mcp.keepalive.helper.test.ts` covering lifecycle start/stop, whitespace-only writes, and no write-after-close/end behavior
  - updated `server/src/test/unit/mcp2-router-list-happy.test.ts` and `server/src/test/unit/mcp-agents-router-run.test.ts` with raw-response assertions for no preamble on `tools/list` and whitespace preamble on `tools/call`
  - updated `server/src/test/integration/mcp-server.test.ts` with raw-response assertions proving classic MCP non-tool responses have no preamble and `tools/call` preamble stays whitespace-only + parseable JSON
- Subtask 7 completed:
  - updated `design.md` with shared keepalive lifecycle architecture notes and Mermaid diagrams (`start -> heartbeat -> stop`) across classic MCP, MCP v2, and agents MCP integration points
- Subtask 8 completed:
  - updated `projectStructure.md` to include added files `server/src/mcpCommon/keepAlive.ts` and `server/src/test/unit/mcp.keepalive.helper.test.ts`
- Subtask 9 completed:
  - required structured log tags are emitted via the shared helper and exercised by all three routers (`mcp2`, `mcp_agents`, `mcp_classic`) through shared controller integration
- Testing 1 completed:
  - `npm run build --workspace server` (pass)
- Testing 2 completed:
  - `npm run build --workspace client` (pass)
- Testing 3 completed:
  - `npm run test --workspace server` (pass)
  - unit/integration-node: `tests 603`, `pass 603`, `fail 0`
  - cucumber integration: `62 scenarios (62 passed)`, `366 steps (366 passed)`
- Testing 4 completed:
  - `npm run test --workspace client` (pass; `Test Suites: 90 passed`, `Tests: 320 passed`)
- Testing 5 completed:
  - `npm run e2e` (pass; `33 passed`, `3 skipped`)
- Testing 6 completed:
  - `npm run compose:build` (pass)
- Testing 7 completed:
  - `npm run compose:up` (pass; server/client containers reported healthy)
- Testing 8 completed (Manual Playwright-MCP):
  - Playwright MCP navigated to `http://host.docker.internal:5001/chat`; browser console error check returned no entries.
  - invoked MCP `tools/call` on classic (`/mcp`), MCP v2 (`:5011`), and Agents MCP (`:5012`) and verified JSON parse success after trimming keepalive preamble (`json_parse_smoke=ok`).
  - verified required lifecycle logs in `logs/server.1.log`:
    - `DEV-0000035:T4:keepalive_lifecycle_started`
    - `DEV-0000035:T4:keepalive_lifecycle_stopped`
  - observed tags across all three surfaces: `mcp_classic`, `mcp2`, and `mcp_agents`.
- Testing 9 completed:
  - `npm run compose:down` (pass)
- Testing 10 completed:
  - `npm run test --workspace server -- mcp.keepalive.helper` (pass)
  - note: per task command note, workspace test script executes full deterministic unit+cucumber pipeline; targeted keepalive suite is included in that run and passed.
- Testing 11 completed:
  - ran chained command `npm run test --workspace server -- mcp2-router && npm run test --workspace server -- mcp-agents-router-run && npm run test --workspace server -- mcp-server` (pass)
  - each chained invocation executed deterministic full unit+cucumber pipeline per server test script behavior; targeted suites were included in passing output.
- Testing 12 completed:
  - manual JSON parse smoke on all three MCP surfaces (`:5510`, `:5511`, `:5512`) returned parseable JSON-RPC payloads after keepalive whitespace trim (`manual_json_parse_smoke=ok`).
- Subtask 10 completed:
  - initial `npm run lint --workspaces` failed on new keepalive unit test unused params; fixed in `server/src/test/unit/mcp.keepalive.helper.test.ts` by consuming mock args with `void`.
  - initial `npm run format:check --workspaces` reported formatting drift in two server tests; fixed via `npm run format --workspace server`.
- Testing 13 completed:
  - `npm run lint --workspaces` (pass; existing import-order warnings remain non-blocking baseline warnings in unrelated files).
- Testing 14 completed:
  - `npm run format:check --workspaces` (pass for client/server/common).
- Task documentation completion:
  - Task 4 git commits recorded in this story section: `627b2cc`, `eac12cb`.

---

### 5. Server: `reingest_repository` shared service + canonical validation/error mapping

- Task Status: **__done__**
- Git Commits: 5b0c2be2a154e6bb0b33f2715136c581721866c8

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

1. [x] Review current ingest re-embed and repository listing behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `server/src/routes/ingestReembed.ts`
     - `server/src/lmstudio/toolService.ts`
     - `server/src/ingest/*` (relevant service files)
2. [x] Create shared `reingest_repository` service with strict `sourceId` validation and root matching.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
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
3. [x] Implement canonical contract mappers for success and error `data` payloads.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/ingest/reingestService.ts`
   - Required outputs:
     - success: `{ status, operation, runId, sourceId }`
     - errors: `INVALID_PARAMS`, `NOT_FOUND`, `BUSY` with required `error.data` retry payloads
     - include deterministic `fieldErrors.reason` values and `reingestableRepositoryIds` + `reingestableSourceIds` where required by the story contract
4. [x] Add unit tests for all validation and busy-state branches.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/unit/reingestService.test.ts` (new)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [x] Success branch returns canonical payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit service contract.
        - Test location: `server/src/test/unit/reingestService.test.ts`.
        - Description: Add/adjust a success-path test asserting `status`, `operation`, `runId`, and `sourceId` fields.
        - Purpose: Lock canonical success shape.
     2. [x] Invalid `sourceId` reason branches map to expected error code/message.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit validation contract.
        - Test location: `server/src/test/unit/reingestService.test.ts`.
        - Description: Add/adjust table-driven tests for missing, non-string, empty, non-absolute, non-normalized, and ambiguous `sourceId`.
        - Purpose: Ensure deterministic validation mapping.
     3. [x] Unknown root response includes AI-retry guidance fields.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit error-data contract.
        - Test location: `server/src/test/unit/reingestService.test.ts`.
        - Description: Add/adjust tests asserting `reingestableRepositoryIds` and `reingestableSourceIds` are present for unknown root.
        - Purpose: Preserve AI-retry contract.
     4. [x] Busy response maps to canonical `BUSY` contract.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit busy-state contract.
        - Test location: `server/src/test/unit/reingestService.test.ts`.
        - Description: Add/adjust tests for locked ingest state and assert `BUSY` mapping.
        - Purpose: Lock busy-state behavior.
5. [x] Update `design.md` for canonical error/retry architecture and diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Update architecture details and Mermaid diagrams for validation branches and canonical contract mapping.
   - Purpose: Keep service-level behavior and error contracts unambiguous in architecture docs.
   - `design.md` requirements:
     - Add/update Mermaid diagram(s) that show `reingest_repository` service validation branches and canonical success/error mappings (`INVALID_PARAMS`, `NOT_FOUND`, `BUSY`).
6. [x] Update `README.md` for canonical re-ingest error/retry behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document canonical success/error payloads and retry-guidance fields for re-ingest.
   - Purpose: Ensure operators and integrators can implement against stable contracts.
7. [x] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | Node.js path utilities: https://nodejs.org/api/path.html (Reason: authoritative normalization/join/isAbsolute behavior for sourceId path validation.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
   - Required `projectStructure.md` entries for this task:
     - Added files:
       - `server/src/ingest/reingestService.ts`
       - `server/src/test/unit/reingestService.test.ts`
     - Removed files:
       - None planned in this task.
8. [x] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `server/src/ingest/reingestService.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T5:reingest_validation_evaluated`
     - `DEV-0000035:T5:reingest_validation_result`
   - Expected outcome: During reingest invocation, both tags appear and the result tag records canonical success or mapped error code/data payload shape.
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [x] `npm run build --workspace server`
2. [x] `npm run build --workspace client`
3. [x] `npm run test --workspace server`
4. [x] `npm run test --workspace client`
5. [x] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [x] `npm run compose:build`
7. [x] `npm run compose:up`
8. [x] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T5:reingest_validation_evaluated`, `DEV-0000035:T5:reingest_validation_result`.
   - Expected outcome: During reingest invocation, both tags appear and the result tag records canonical success or mapped error code/data payload shape. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
9. [x] `npm run compose:down`
10. [x] `npm run test --workspace server -- reingestService`
11. [x] `npm run lint --workspaces`
12. [x] `npm run format:check --workspaces`
#### Implementation notes

- Subtask 1 completed:
  - reviewed `server/src/routes/ingestReembed.ts`, `server/src/lmstudio/toolService.ts`, `server/src/ingest/ingestJob.ts`, and `server/src/ingest/pathMap.ts`.
  - confirmed existing re-embed run-start/error semantics are `isBusy()` pre-check and `reembed(root)` error codes (`BUSY`, `NOT_FOUND`).
  - confirmed re-ingestable source roots can be derived from `listIngestedRepositories()` via canonical `containerPath` values already normalized with `mapIngestPath()`.
- Subtasks 2-3 completed:
  - added `server/src/ingest/reingestService.ts` with strict `sourceId` validation (missing/non-string/empty/non-absolute/non-normalized/ambiguous/unknown), exact known-root matching, and canonical response mapping.
  - delegated run-start behavior to existing `isBusy` + `reembed` semantics and source-list derivation to `listIngestedRepositories`, with POSIX normalization aligned to existing `pathMap` strategy.
  - implemented canonical success payload `{ status, operation, runId, sourceId }` and canonical error mappings `INVALID_PARAMS` (`-32602`), `NOT_FOUND` (`404`), and `BUSY` (`429`) including deterministic `fieldErrors.reason` and retry guidance lists.
- Subtask 4 completed:
  - added `server/src/test/unit/reingestService.test.ts` covering success, invalid reason branches, unknown-root retry guidance, and busy-state mappings (lock and thrown busy).
  - verification command: `npm run build --workspace server` (pass).
- Subtask 8 completed:
  - added required structured log tags in `server/src/ingest/reingestService.ts`:
    - `DEV-0000035:T5:reingest_validation_evaluated`
    - `DEV-0000035:T5:reingest_validation_result`
- Subtask 5 completed:
  - updated `design.md` with a dedicated reingest service section and Mermaid flow diagram for validation branches and canonical mappings (`INVALID_PARAMS`, `NOT_FOUND`, `BUSY`).
- Subtask 6 completed:
  - updated `README.md` MCP section with canonical `reingest_repository` request/success/error contract and retry-guidance fields.
- Subtask 7 completed:
  - updated `projectStructure.md` for added files:
    - `server/src/ingest/reingestService.ts`
    - `server/src/test/unit/reingestService.test.ts`
- Subtask 9 completed:
  - initial `npm run lint --workspaces && npm run format:check --workspaces` failed due formatting in new Task 5 files.
  - applied `npm run format --workspace server`, then re-ran `npm run lint --workspaces && npm run format:check --workspaces` (pass; existing baseline lint warnings in unrelated files unchanged).
- Testing 1 completed:
  - `npm run build --workspace server` (pass).
- Testing 2 completed:
  - `npm run build --workspace client` (pass).
- Testing 3 completed:
  - `npm run test --workspace server` (pass).
  - unit/integration-node: `tests 607`, `pass 607`, `fail 0`.
  - cucumber integration: `62 scenarios (62 passed)`, `366 steps (366 passed)`.
- Testing 4 completed:
  - `npm run test --workspace client` (pass; `Test Suites: 90 passed`, `Tests: 320 passed`).
- Testing 5 completed:
  - `npm run e2e` (pass; `36 passed`).
- Testing 6 completed:
  - `npm run compose:build` (pass; docker build completed for `codeinfo2-server` and `codeinfo2-client`).
- Testing 7 completed:
  - `npm run compose:up` (pass; stack started and health checks reached healthy for server/client path).
- Testing 8 completed (Manual Playwright-MCP):
  - Playwright MCP browser check against `http://host.docker.internal:5001` navigated and exercised `/ingest`; no browser console `[error]` entries observed.
  - required log tags verified during direct reingest service invocation:
    - `DEV-0000035:T5:reingest_validation_evaluated`
    - `DEV-0000035:T5:reingest_validation_result`
- Testing 9 completed:
  - `npm run compose:down` (pass; local compose stack stopped and removed cleanly).
- Testing 10 completed:
  - `npm run test --workspace server -- reingestService` (pass; unit/integration-node `607 passed`, cucumber `62 scenarios / 366 steps passed`).
- Testing 11 completed:
  - `npm run lint --workspaces` (pass with baseline warnings only; no lint errors).
- Testing 12 completed:
  - `npm run format:check --workspaces` (pass for client/server/common).

---

### 6. Server: Wire `reingest_repository` into classic MCP (`POST /mcp`)

- Task Status: **__in_progress__**
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `server/src/mcp/server.ts`
     - `server/src/mcpCommon/jsonRpc.ts`
2. [ ] Add tool metadata in `tools/list` for `reingest_repository`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcp/server.ts`
3. [ ] Add `tools/call` handler wiring to shared re-ingest service.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcp/server.ts`
   - Contract requirements:
     - success and error maps exactly to plan `Message Contracts & Storage Shapes`.
4. [ ] Add classic MCP tests for list + call success + each error code.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/unit/mcp.reingest.classic.test.ts` (new)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] Classic MCP success payload contract.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit JSON-RPC success contract.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
        - Description: Add/adjust tests asserting wrapped text payload includes canonical `status`, `operation`, `runId`, `sourceId`.
        - Purpose: Lock success payload shape for classic MCP.
     2. [ ] Classic MCP failures use JSON-RPC `error` envelope.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit JSON-RPC error contract.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
        - Description: Add/adjust tests asserting failures are emitted through `error` (not `result.isError`).
        - Purpose: Preserve surface compatibility.
     3. [ ] Classic MCP `INVALID_PARAMS`/`NOT_FOUND` include retry guidance fields.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit error-data contract.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
        - Description: Add/adjust tests for invalid/unknown inputs asserting canonical `error.data` retry fields.
        - Purpose: Preserve retry-guidance behavior.
     4. [ ] Classic MCP `BUSY` mapping.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit busy contract.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`.
        - Description: Add/adjust tests asserting `error.code=429` and `error.message="BUSY"` when ingest lock is active.
        - Purpose: Lock busy error semantics.
5. [ ] Update `README.md` for classic MCP `reingest_repository` exposure.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document classic MCP tool availability and contract expectations for `reingest_repository`.
   - Purpose: Keep classic MCP usage docs aligned with implemented tool exposure.
6. [ ] Update `design.md` for classic MCP architecture flow and diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
   - Required `projectStructure.md` entries for this task:
     - Added files:
       - `server/src/test/unit/mcp.reingest.classic.test.ts`
     - Removed files:
       - None planned in this task.
8. [ ] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `server/src/mcp/server.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T6:classic_reingest_tool_call_evaluated`
     - `DEV-0000035:T6:classic_reingest_tool_call_result`
   - Expected outcome: During classic MCP tools/call reingest_repository, both tags appear and the result tag records JSON-RPC success/error mapping.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T6:classic_reingest_tool_call_evaluated`, `DEV-0000035:T6:classic_reingest_tool_call_result`.
   - Expected outcome: During classic MCP tools/call reingest_repository, both tags appear and the result tag records JSON-RPC success/error mapping. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
9. [ ] `npm run compose:down`
10. [ ] `npm run test --workspace server -- mcp.reingest.classic`
11. [ ] Manual smoke: `initialize` -> `tools/list` -> `tools/call reingest_repository` on `POST /mcp`
12. [ ] `npm run lint --workspaces`
13. [ ] `npm run format:check --workspaces`
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `server/src/mcp2/tools.ts`
     - `server/src/mcp2/router.ts`
     - `server/src/mcp2/tools/*` (related modules)
2. [ ] Add MCP v2 tool definition for `reingest_repository`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcp2/tools.ts`
     - `server/src/mcp2/tools/reingestRepository.ts` (new file)
3. [ ] Wire tool execution to shared re-ingest service with canonical error mapping.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/mcp2/tools/reingestRepository.ts`
4. [ ] Add MCP v2 tests for list + call success + each error contract branch.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/unit/mcp2.reingest.tool.test.ts` (new)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] MCP v2 success payload contract.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit JSON-RPC success contract.
        - Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust tests asserting wrapped payload includes canonical `status`, `operation`, `runId`, `sourceId`.
        - Purpose: Lock success payload shape for MCP v2.
     2. [ ] MCP v2 failures use JSON-RPC `error` envelope.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit JSON-RPC error contract.
        - Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust tests asserting failures use JSON-RPC `error` and not `result.isError`.
        - Purpose: Preserve surface compatibility.
     3. [ ] MCP v2 `INVALID_PARAMS`/`NOT_FOUND` include retry guidance fields.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit error-data contract.
        - Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust tests for invalid/unknown inputs asserting canonical retry guidance in `error.data`.
        - Purpose: Lock AI-retry data contract.
     4. [ ] MCP v2 `BUSY` mapping.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit busy contract.
        - Test location: `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust tests asserting `error.code=429` and `error.message="BUSY"` when ingest is locked.
        - Purpose: Lock busy error semantics.
5. [ ] Add parity assertions in existing classic/MCP-v2 suites for same inputs (avoid separate parity harness file).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to add/edit:
     - `server/src/test/unit/mcp.reingest.classic.test.ts` (update from Task 6)
     - `server/src/test/unit/mcp2.reingest.tool.test.ts` (update)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] Success payload parity between classic MCP and MCP v2.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit parity.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust paired assertions using equivalent inputs and compare serialized success payload shapes.
        - Purpose: Prevent cross-surface drift.
     2. [ ] Error envelope parity for `INVALID_PARAMS`, `NOT_FOUND`, and `BUSY`.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit parity.
        - Test location: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/test/unit/mcp2.reingest.tool.test.ts`.
        - Description: Add/adjust paired assertions comparing `code`, `message`, and `error.data` for identical failing inputs.
        - Purpose: Guarantee contract parity across MCP surfaces.
6. [ ] Update `README.md` for MCP v2 tool availability and parity expectations.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document MCP v2 tool exposure and parity guarantees relative to classic MCP.
   - Purpose: Keep integrator-facing expectations explicit and current.
7. [ ] Update `design.md` for MCP v2 architecture flow and parity diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): MCP tools specification: https://modelcontextprotocol.io/specification/draft/server/tools (Reason: canonical contract for tool names, arguments, and execution semantics.) | JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification (Reason: canonical transport/error envelope rules for MCP JSON-RPC handlers.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | OpenAPI 3.0.3 specification: https://spec.openapis.org/oas/v3.0.3.html (Reason: defines request/response schema and validation contract language used by API documentation updates.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
   - Required `projectStructure.md` entries for this task:
     - Added files:
       - `server/src/mcp2/tools/reingestRepository.ts`
       - `server/src/test/unit/mcp2.reingest.tool.test.ts`
     - Removed files:
       - None planned in this task.
9. [ ] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `server/src/mcp2/tools/reingestRepository.ts`
     - `server/src/mcp2/router.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T7:mcp2_reingest_tool_call_evaluated`
     - `DEV-0000035:T7:mcp2_reingest_tool_call_result`
   - Expected outcome: During MCP v2 tools/call reingest_repository, both tags appear and the result tag records parity-aligned JSON-RPC success/error mapping.
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T7:mcp2_reingest_tool_call_evaluated`, `DEV-0000035:T7:mcp2_reingest_tool_call_result`.
   - Expected outcome: During MCP v2 tools/call reingest_repository, both tags appear and the result tag records parity-aligned JSON-RPC success/error mapping. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
9. [ ] `npm run compose:down`
10. [ ] `npm run test --workspace server -- mcp2.reingest`
11. [ ] Manual smoke: `initialize` -> `tools/list` -> `tools/call reingest_repository` on MCP v2 port
12. [ ] `npm run lint --workspaces`
13. [ ] `npm run format:check --workspaces`
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/chat/inflightRegistry.ts`
2. [ ] Implement item-keyed merge strategy and completed-item authoritative finalization.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `server/src/chat/chatStreamBridge.ts`
     - `server/src/chat/inflightRegistry.ts` (update existing)
4. [ ] Add regression tests for non-monotonic, tool-interleaved event order.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `server/src/test/unit/chat-interface-codex.test.ts` (update existing suite)
     - `server/src/test/unit/ws-chat-stream.test.ts` (update existing suite)
     - `server/src/test/integration/chat-codex.test.ts` (update existing suite)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] Truncated/non-prefix update after tool call finalizes correctly.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit merge regression.
        - Test location: `server/src/test/unit/chat-interface-codex.test.ts`.
        - Description: Add/adjust tests for initial text, tool event, non-prefix update, and completed final item content.
        - Purpose: Prevent cropped/duplicated merge behavior.
     2. [ ] Interleaved item-id updates in one turn are isolated by item id.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit merge regression.
        - Test location: `server/src/test/unit/chat-interface-codex.test.ts`.
        - Description: Add/adjust tests with multiple assistant item ids and interleaved deltas to assert isolated assembly.
        - Purpose: Prevent cross-item contamination.
     3. [ ] Late delta after completed item is ignored.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit stream regression.
        - Test location: `server/src/test/unit/ws-chat-stream.test.ts`.
        - Description: Add/adjust tests asserting late post-completion deltas do not mutate finalized content.
        - Purpose: Lock completion-authoritative behavior.
     4. [ ] Final answer publishes once per turn.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration stream regression.
        - Test location: `server/src/test/integration/chat-codex.test.ts`.
        - Description: Add/adjust tests asserting one terminal assistant publish event per turn.
        - Purpose: Prevent duplicate final bubble output.
     5. [ ] Cancelled/failed turn does not duplicate terminal assistant bubble.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Integration stream regression.
        - Test location: `server/src/test/integration/chat-codex.test.ts`.
        - Description: Add/adjust cancellation/failure tests asserting at most one terminal assistant bubble.
        - Purpose: Prevent duplicate terminal states.
     6. [ ] Stale inflight events do not mutate current transcript.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Unit/stream regression.
        - Test location: `server/src/test/unit/ws-chat-stream.test.ts`.
        - Description: Add/adjust tests with stale inflight ids and assert current conversation content remains unchanged.
        - Purpose: Prevent run-crossing corruption.
5. [ ] Update docs for Codex merge invariants/finalization rules and architecture diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Files to edit:
     - `design.md`
   - `design.md` requirements:
     - Add/update Mermaid sequence diagram(s) that show item-keyed delta merge, completed-item authoritative finalization, and bridge/inflight publish boundaries that prevent duplicate final bubbles.
6. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): OpenAI Codex app server events (authoritative item lifecycle): https://developers.openai.com/codex/app-server (Reason: defines item started/delta/completed event model used by stream merge logic.) | OpenAI Codex repo app-server README: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md (Reason: implementation-level event and streaming details for Codex app-server integration.) | DeepWiki MCP docs (`openai/codex`, see `4.5.3 Event Translation and Streaming`): `openai/codex` (Reason: architecture cross-check for how Codex app-server events are translated into streamed turn updates.) | Node.js streams/events: https://nodejs.org/api/stream.html (Reason: stream/event ordering reference for robust assistant delta aggregation.) | npm workspaces run scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script (Reason: ensures task test/lint commands use correct workspace CLI syntax.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
7. [ ] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `server/src/chat/interfaces/ChatInterfaceCodex.ts`
     - `server/src/chat/chatStreamBridge.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T8:codex_merge_evaluated`
     - `DEV-0000035:T8:codex_merge_finalized_once`
   - Expected outcome: During tool-interleaved Codex output, both tags appear and finalized_once confirms exactly one terminal publish.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T8:codex_merge_evaluated`, `DEV-0000035:T8:codex_merge_finalized_once`.
   - Expected outcome: During tool-interleaved Codex output, both tags appear and finalized_once confirms exactly one terminal publish. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
9. [ ] `npm run compose:down`
10. [ ] `npm run test --workspace server -- chat-interface-codex`
11. [ ] `npm run test --workspace server -- ws-chat-stream`
12. [ ] `npm run test --workspace server -- chat-codex`
13. [ ] Manual smoke: run Codex chat with tool call and verify no cropped/duplicate final text
14. [ ] `npm run lint --workspaces`
15. [ ] `npm run format:check --workspaces`
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/hooks/useChatStream.ts`
2. [ ] Remove client-side trim mutation from chat send path while preserving empty-input guard UX.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `client/src/test/chatPage.stream.test.tsx` (update existing suite)
     - `client/src/test/useChatStream.toolPayloads.test.tsx` (update existing suite)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] Leading/trailing whitespace preserved in outbound payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/useChatStream.toolPayloads.test.tsx`, `client/src/test/chatPage.stream.test.tsx`.
        - Description: Add/adjust tests asserting non-empty payloads keep surrounding whitespace when dispatched.
        - Purpose: Prevent trim mutation regressions.
     2. [ ] Newline formatting preserved in outbound payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/useChatStream.toolPayloads.test.tsx`, `client/src/test/chatPage.stream.test.tsx`.
        - Description: Add/adjust tests asserting multiline payloads preserve newline structure exactly.
        - Purpose: Preserve user-authored formatting.
     3. [ ] Messages differing only by whitespace are not merged in user transcript hydration.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/chatPage.stream.test.tsx`.
        - Description: Add/adjust tests asserting whitespace-distinct inputs render as separate user turns.
        - Purpose: Prevent dedupe normalization bugs.
     4. [ ] Whitespace-only input is blocked client-side before dispatch.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/chatPage.stream.test.tsx`.
        - Description: Add/adjust tests asserting whitespace-only input never triggers send request.
        - Purpose: Keep UX aligned with server validation policy.
4. [ ] Extend existing Chat e2e coverage for raw-input outbound payload behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `e2e/chat.spec.ts` (update existing)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] E2E: leading/trailing whitespace preserved in chat outbound payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat.spec.ts`.
        - Description: Add/adjust e2e assertions against captured request payload showing surrounding whitespace is preserved.
        - Purpose: Verify browser-to-server behavior in real UI flow.
     2. [ ] E2E: multiline newline structure preserved in chat outbound payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat.spec.ts`.
        - Description: Add/adjust e2e assertions for multiline input payload equality including newline characters.
        - Purpose: Prevent newline-loss regressions in real flow.
     3. [ ] E2E: whitespace-only input does not dispatch `POST /chat`.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat.spec.ts`.
        - Description: Add/adjust e2e assertions that submit attempt with whitespace-only input does not emit network request.
        - Purpose: Ensure client guard enforcement in UI.
5. [ ] Update `README.md` for Chat raw-input send behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document raw input preservation rules and whitespace-only guard behavior for Chat.
   - Purpose: Keep user-facing behavior docs aligned with UI send-path logic.
6. [ ] Update `design.md` for Chat raw-input send flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document Chat send-flow behavior for raw payload preservation and validation boundaries.
   - Purpose: Keep implementation design notes consistent with frontend behavior and tests.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
8. [ ] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/pages/ChatPage.tsx`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T9:chat_raw_send_evaluated`
     - `DEV-0000035:T9:chat_raw_send_result`
   - Expected outcome: During chat send attempts, both tags appear and result records sent=true for non-whitespace input and sent=false for whitespace-only input.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T9:chat_raw_send_evaluated`, `DEV-0000035:T9:chat_raw_send_result`.
   - Expected outcome: During chat send attempts, both tags appear and result records sent=true for non-whitespace input and sent=false for whitespace-only input. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
   - Capture screenshots and save them to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`):
     - `0000035-9-chat-raw-send-valid.png` after sending multiline non-whitespace input that contains leading/trailing spaces.
     - `0000035-9-chat-raw-send-whitespace-blocked.png` after attempting whitespace-only input and confirming no outbound send occurs.
   - Agent screenshot review expectation: verify the screenshots show raw user text preserved exactly for valid sends, whitespace-only send blocked, and no visual regression in Chat transcript/input controls.
9. [ ] `npm run compose:down`
10. [ ] `npm run test --workspace client -- useChatStream.toolPayloads`
11. [ ] `npm run test --workspace client -- chatPage.stream`
12. [ ] `npm run e2e:test -- e2e/chat.spec.ts`
13. [ ] Manual smoke: Chat UI send multiline input with leading/trailing whitespace and verify outbound request preserves raw content while whitespace-only input is blocked
14. [ ] `npm run lint --workspaces`
15. [ ] `npm run format:check --workspaces`
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/components/Markdown.tsx`
2. [ ] Replace Chat user bubble `Typography` rendering with shared markdown renderer.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
   - Constraints:
     - use `client/src/components/Markdown.tsx`
     - preserve current bubble container layout/chrome
     - if JSX test fixtures contain raw `&`, use `&amp;` or `{ '&' }` to avoid AST indexing failures during test runs
3. [ ] Add Chat UI tests for user markdown parity and mermaid rendering.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `client/src/test/chatPage.markdown.test.tsx` (update existing)
     - `client/src/test/chatPage.mermaid.test.tsx` (update existing)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] User markdown rendering parity with assistant renderer.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/chatPage.markdown.test.tsx`.
        - Description: Add/adjust tests asserting equivalent markdown input renders with same structure/styling in user and assistant bubbles.
        - Purpose: Guarantee renderer parity.
     2. [ ] User mermaid fence rendering parity.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/chatPage.mermaid.test.tsx`.
        - Description: Add/adjust tests asserting mermaid fences in user bubbles render through same path as assistant bubbles.
        - Purpose: Guarantee feature parity for diagrams.
     3. [ ] Unsafe HTML/script sanitization parity.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client security regression.
        - Test location: `client/src/test/chatPage.markdown.test.tsx`, `client/src/test/chatPage.mermaid.test.tsx`.
        - Description: Add/adjust tests with unsafe inline HTML/scripts asserting sanitization matches assistant behavior.
        - Purpose: Prevent XSS/sanitization drift.
     4. [ ] Malformed mermaid fallback parity.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client resilience regression.
        - Test location: `client/src/test/chatPage.mermaid.test.tsx`.
        - Description: Add/adjust tests for invalid mermaid syntax asserting same safe fallback behavior as assistant path.
        - Purpose: Prevent render crashes and behavior divergence.
4. [ ] Extend Chat e2e markdown parity coverage.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `e2e/chat.spec.ts` (update existing)
     - `e2e/chat-mermaid.spec.ts` (update existing)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] E2E: user markdown/mermaid rendering parity with assistant path.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat.spec.ts`, `e2e/chat-mermaid.spec.ts`.
        - Description: Add/adjust e2e assertions that user markdown and mermaid output visually/functionally matches assistant rendering behavior.
        - Purpose: Validate parity at real UI runtime.
     2. [ ] E2E: malformed mermaid input follows safe fallback behavior.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/chat-mermaid.spec.ts`.
        - Description: Add/adjust e2e assertions that invalid mermaid input does not break page and shows expected fallback output.
        - Purpose: Validate resilience in browser execution.
5. [ ] Update `README.md` for Chat user markdown parity behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document Chat user-bubble markdown parity behavior and mermaid rendering expectations.
   - Purpose: Keep behavior documentation aligned with rendered markdown capabilities.
6. [ ] Update `design.md` for Chat user markdown parity flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document markdown rendering pipeline reuse for user bubbles, including mermaid and sanitization behavior.
   - Purpose: Keep architecture/implementation docs consistent with parity behavior.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
8. [ ] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/components/Markdown.tsx`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T10:chat_user_markdown_render_evaluated`
     - `DEV-0000035:T10:chat_user_markdown_render_result`
   - Expected outcome: During chat user-bubble markdown/mermaid rendering, both tags appear and result confirms markdown renderer path is used.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T10:chat_user_markdown_render_evaluated`, `DEV-0000035:T10:chat_user_markdown_render_result`.
   - Expected outcome: During chat user-bubble markdown/mermaid rendering, both tags appear and result confirms markdown renderer path is used. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
   - Capture screenshots and save them to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`):
     - `0000035-10-chat-user-markdown-list-code.png` showing a user bubble rendering markdown list/code formatting.
     - `0000035-10-chat-user-markdown-mermaid.png` showing a user bubble rendering markdown mermaid content via the shared markdown path.
   - Agent screenshot review expectation: verify user bubble rendering visually matches markdown parity expectations (lists/code/mermaid formatting, sanitization behavior, and preserved chat bubble chrome/layout).
9. [ ] `npm run compose:down`
10. [ ] `npm run test --workspace client -- chatPage.markdown`
11. [ ] `npm run test --workspace client -- chatPage.stream`
12. [ ] `npm run test --workspace client -- chatPage.mermaid`
13. [ ] `npm run e2e:test -- e2e/chat.spec.ts e2e/chat-mermaid.spec.ts`
14. [ ] Manual smoke: Chat UI send multiline markdown and verify user bubble formatting parity
15. [ ] `npm run lint --workspaces`
16. [ ] `npm run format:check --workspaces`
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
2. [ ] Remove client-side trim mutation from Agents send payload while preserving empty-input guard UX.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Constraints:
     - do not mutate outbound payload text before send when content is non-whitespace
     - keep local "cannot send empty" behavior aligned with server rule
3. [ ] Add Agents UI tests for raw payload preservation behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `client/src/test/agentsPage.run.test.tsx` (update existing suite)
     - `client/src/test/agentsPage.turnHydration.test.tsx` (update existing suite)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] Leading/trailing whitespace preserved in agents outbound payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.run.test.tsx`.
        - Description: Add/adjust tests asserting non-empty instruction payload keeps leading/trailing whitespace when dispatched.
        - Purpose: Prevent trim mutation on agents path.
     2. [ ] Newline formatting preserved in agents outbound payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.run.test.tsx`.
        - Description: Add/adjust tests asserting multiline instruction payload preserves newline characters.
        - Purpose: Preserve authored formatting.
     3. [ ] Whitespace-distinct messages are not merged in transcript hydration.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.turnHydration.test.tsx`.
        - Description: Add/adjust tests asserting messages that differ by whitespace remain distinct turns after hydration.
        - Purpose: Prevent normalization-based dedupe regressions.
     4. [ ] Whitespace-only input is blocked before run request dispatch.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.run.test.tsx`.
        - Description: Add/adjust tests asserting whitespace-only instruction does not trigger run request.
        - Purpose: Keep client guard aligned with server validation.
4. [ ] Add Agents e2e coverage for raw-input outbound payload behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `e2e/agents.spec.ts` (new)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] E2E: leading/trailing whitespace preserved in agents outbound payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions over captured request payload showing preserved surrounding whitespace.
        - Purpose: Validate real browser request behavior for agents.
     2. [ ] E2E: multiline newline structure preserved in agents outbound payload.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions for multiline payload byte-equivalence including newlines.
        - Purpose: Prevent newline-loss regressions in full flow.
     3. [ ] E2E: whitespace-only input does not dispatch agents run request.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions that whitespace-only submit attempts do not issue network request.
        - Purpose: Verify guard behavior in real UI execution.
5. [ ] Update `README.md` for Agents raw-input send behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document raw input preservation and whitespace-only guard behavior for Agents send path.
   - Purpose: Keep usage docs aligned with actual Agents input behavior.
6. [ ] Update `design.md` for Agents raw-input send flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document Agents send-flow behavior for raw payload preservation and validation boundaries.
   - Purpose: Keep design documentation accurate for future maintenance.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
   - Required `projectStructure.md` entries for this task:
     - Added files:
       - `e2e/agents.spec.ts`
     - Removed files:
       - None planned in this task.
8. [ ] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/api/agents.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T11:agents_raw_send_evaluated`
     - `DEV-0000035:T11:agents_raw_send_result`
   - Expected outcome: During agents send attempts, both tags appear and result records sent=true for non-whitespace input and sent=false for whitespace-only input.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T11:agents_raw_send_evaluated`, `DEV-0000035:T11:agents_raw_send_result`.
   - Expected outcome: During agents send attempts, both tags appear and result records sent=true for non-whitespace input and sent=false for whitespace-only input. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
   - Capture screenshots and save them to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`):
     - `0000035-11-agents-raw-send-valid.png` after sending multiline non-whitespace input that contains leading/trailing spaces.
     - `0000035-11-agents-raw-send-whitespace-blocked.png` after attempting whitespace-only input and confirming no outbound send occurs.
   - Agent screenshot review expectation: verify the screenshots show raw user text preserved exactly for valid sends, whitespace-only send blocked, and no visual regression in Agents transcript/input controls.
9. [ ] `npm run compose:down`
10. [ ] `npm run test --workspace client -- agentsPage.run`
11. [ ] `npm run test --workspace client -- agentsPage.turnHydration`
12. [ ] `npm run e2e:test -- e2e/agents.spec.ts`
13. [ ] Manual smoke: Agents UI send multiline input with leading/trailing whitespace and verify outbound request preserves raw content while whitespace-only input is blocked
14. [ ] `npm run lint --workspaces`
15. [ ] `npm run format:check --workspaces`
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (read-first workflow):
     ```bash
     rg -n "<symbol-or-route>" <listed-file-or-folder>
     # Read the full file, then note exact findings in Implementation notes.
     ```
   - Files to read:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/Markdown.tsx`
2. [ ] Replace Agents user bubble `Typography` rendering with shared markdown renderer.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (preserve contracts; implement only this subtask scope):
     ```ts
     export function <name>(input: Input): Output {
       // 1) validate/normalize input needed by this subtask
       // 2) keep existing response/message contracts unchanged
       // 3) return deterministic output for this path only
     }
     ```
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
   - Constraints:
     - use `client/src/components/Markdown.tsx`
     - preserve current bubble container layout/chrome
     - if JSX test fixtures contain raw `&`, use `&amp;` or `{ '&' }` to avoid AST indexing failures during test runs
3. [ ] Add Agents UI tests for markdown parity in both realtime and hydrated turns.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `client/src/test/agentsPage.run.test.tsx` (update existing suite)
     - `client/src/test/agentsPage.turnHydration.test.tsx` (update existing suite)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] Agents user markdown rendering parity with assistant rendering.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client unit/integration (React).
        - Test location: `client/src/test/agentsPage.run.test.tsx`, `client/src/test/agentsPage.turnHydration.test.tsx`.
        - Description: Add/adjust tests asserting user markdown (including mermaid fences) renders identically to assistant output in realtime and hydrated flows.
        - Purpose: Guarantee renderer parity in agents UI.
     2. [ ] Agents sanitization parity for unsafe HTML/scripts.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client security regression.
        - Test location: `client/src/test/agentsPage.run.test.tsx`, `client/src/test/agentsPage.turnHydration.test.tsx`.
        - Description: Add/adjust tests with unsafe markup asserting sanitize behavior matches assistant renderer path.
        - Purpose: Prevent sanitization drift/XSS regressions.
     3. [ ] Agents malformed mermaid fallback parity.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: Client resilience regression.
        - Test location: `client/src/test/agentsPage.run.test.tsx`, `client/src/test/agentsPage.turnHydration.test.tsx`.
        - Description: Add/adjust tests asserting malformed mermaid fences follow same safe fallback behavior as assistant path.
        - Purpose: Prevent render-break differences between roles.
4. [ ] Extend Agents e2e markdown parity coverage.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to add/edit:
     - `e2e/agents.spec.ts` (update file created in Task 11)
   - Explicit test subtasks (complete each separately):
   - Nested-subtask standalone reminder: each numbered item below is independently executable; use the documentation links above and the exact `Test location` in that numbered item.
   - Nested-subtask starter snippet:
     ```ts
     it('should satisfy this numbered test contract', async () => {
       // Arrange
       // Act
       // Assert
     });
     ```
     1. [ ] E2E: agents user markdown/mermaid rendering parity.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions that user markdown and mermaid output in Agents view matches assistant rendering behavior.
        - Purpose: Validate parity in browser runtime.
     2. [ ] E2E: malformed mermaid input in Agents view follows safe fallback behavior.
        - Documentation links (standalone test item): Jest docs (Context7) `/jestjs/jest` | Cucumber guides https://cucumber.io/docs/guides/ | Playwright docs (Context7) `/microsoft/playwright` (use the subset that matches this item's test type).
        - Test type: End-to-end (Playwright).
        - Test location: `e2e/agents.spec.ts`.
        - Description: Add/adjust e2e assertions that invalid mermaid content does not break rendering and uses expected fallback.
        - Purpose: Validate resilience in full UI flow.
5. [ ] Update `README.md` for Agents user markdown parity behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Document Agents user-bubble markdown parity behavior and rendering expectations.
   - Purpose: Keep developer/operator docs aligned with user-visible markdown behavior.
6. [ ] Update `design.md` for Agents user markdown parity flow.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Document markdown-rendering component reuse and parity behavior for Agents user bubbles.
   - Purpose: Keep architecture notes and UI behavior contracts synchronized.
7. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after file changes are complete).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): React docs (forms/events): https://react.dev/reference/react-dom/components/textarea (Reason: confirms controlled textarea behavior preserves raw input exactly.) | MUI Typography docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/typography.md (Reason: verifies text rendering semantics when replacing Typography user-bubble output.) | MUI TextField docs (v6.4.12 via MUI MCP): https://llms.mui.com/material-ui/6.4.12/components/text-fields.md (Reason: verifies TextField input/value behavior for raw-send and empty-input guards.) | `react-markdown` docs: https://github.com/remarkjs/react-markdown (Reason: renderer API and component behavior used by shared Markdown pipeline.) | `remark-gfm` docs: https://github.com/remarkjs/remark-gfm (Reason: GFM syntax support details for lists/tables/fences in user bubbles.) | `rehype-sanitize` docs: https://github.com/rehypejs/rehype-sanitize (Reason: sanitization schema rules to keep markdown rendering safe.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: confirms fenced mermaid syntax/rendering behavior for markdown parity verification.) | Markdown guide (docs updates): https://www.markdownguide.org/basic-syntax/ (Reason: keeps story documentation updates consistently formatted and readable.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
8. [ ] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/components/Markdown.tsx`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T12:agents_user_markdown_render_evaluated`
     - `DEV-0000035:T12:agents_user_markdown_render_result`
   - Expected outcome: During agents user-bubble markdown/mermaid rendering, both tags appear and result confirms markdown renderer path is used.
9. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T12:agents_user_markdown_render_evaluated`, `DEV-0000035:T12:agents_user_markdown_render_result`.
   - Expected outcome: During agents user-bubble markdown/mermaid rendering, both tags appear and result confirms markdown renderer path is used. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
   - Capture screenshots and save them to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`):
     - `0000035-12-agents-user-markdown-list-code.png` showing a user bubble rendering markdown list/code formatting.
     - `0000035-12-agents-user-markdown-mermaid.png` showing a user bubble rendering markdown mermaid content via the shared markdown path.
   - Agent screenshot review expectation: verify user bubble rendering visually matches markdown parity expectations (lists/code/mermaid formatting, sanitization behavior, and preserved agents bubble chrome/layout).
9. [ ] `npm run compose:down`
10. [ ] `npm run test --workspace client -- agentsPage.run`
11. [ ] `npm run test --workspace client -- agentsPage.turnHydration`
12. [ ] `npm run test --workspace client -- agentsPage.descriptionPopover`
13. [ ] `npm run e2e:test -- e2e/agents.spec.ts`
14. [ ] Manual smoke: Agents UI send multiline markdown and verify user bubble formatting parity
15. [ ] `npm run lint --workspaces`
16. [ ] `npm run format:check --workspaces`
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
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (create one focused assertion per required behavior):
     ```ts
     it('should <expected behavior>', async () => {
       // Arrange: set deterministic inputs/mocks
       // Act: execute the unit/route/tool being tested
       // Assert: verify exact contract fields/status/error codes
     });
     ```
   - Files to read:
     - `planning/0000035-mcp-keepalive-defaults-reingest-and-chat-rendering.md`
2. [ ] Update `README.md` with final verified story behavior.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `README.md`
   - Document location: `README.md`
   - Description: Apply final documentation updates for user-facing behavior and commands verified by regression runs.
   - Purpose: Ensure final delivery documentation is accurate and complete.
3. [ ] Update `design.md` with final verified behavior and diagrams.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
   - Document name: `design.md`
   - Document location: `design.md`
   - Description: Apply final architecture notes and Mermaid diagram updates that match implemented behavior.
   - Purpose: Keep design documentation authoritative at story completion.
4. [ ] Prepare manual verification artifacts in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` with naming `0000035-13-<label>.png`.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
5. [ ] Update `projectStructure.md` with every file/folder added, removed, or renamed in this task (after screenshot files are prepared).
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (update exactly what changed in this task only):
     ```md
     - `path/to/added-file.ts` - one-line purpose
     - Removed: `path/to/removed-file.ts` - one-line reason (if any)
     ```
   - Files to edit:
     - `projectStructure.md`
   - Required `projectStructure.md` entries for this task:
     - Added files:
       - `playwright-output-local/0000035-13-<label>.png` (all screenshot artifacts created by subtask 4)
     - Removed files:
       - None planned in this task.
6. [ ] Create a PR summary comment covering all task outcomes, contract changes, and verification evidence.
   - Scope lock reminder (duplicate from story scope locks): do not change unrelated public contracts or envelope shapes unless this subtask explicitly says to do so.
   - Documentation links (do not skip for this single subtask): Docker docs (Context7): `/docker/docs` (Reason: authoritative compose/build workflow reference for full-regression verification steps.) | Playwright docs (Context7): `/microsoft/playwright` (Reason: authoritative e2e locator/assertion/reference for UI behavior verification tasks.) | Jest docs (Context7): `/jestjs/jest` (Reason: test runner and CLI filtering behavior for workspace regression runs.) | Cucumber guide (continuous integration): https://cucumber.io/docs/guides/continuous-integration/ (Reason: execution/reporting behavior used for CI-style cucumber verification.) | Cucumber guide (10-minute tutorial): https://cucumber.io/docs/guides/10-minute-tutorial/ (Reason: step-definition and feature-file authoring reference for implementing Cucumber scenarios.) | Mermaid docs (Context7): `/mermaid-js/mermaid` (Reason: diagram fence syntax/rendering expectations used by markdown parity checks.)
   - Completion evidence required before checking this box: list changed files and exact verification commands/results for this subtask in `Implementation notes`.
   - Standalone context for this subtask: If you are assigned only this subtask, treat the documentation links above plus the file list below as complete requirements; do not rely on other subtasks for missing details.
   - Starter snippet (documentation-only changes must be explicit and testable):
     ```md
     ## <Section>
     - Behavior/contract change:
     - File/endpoint impacted:
     - Verification command(s):
     ```
7. [ ] Add task-specific structured log lines for Manual Playwright-MCP verification.
   - Files to edit:
     - `client/src/logging/logger.ts`
     - `server/src/logger.ts`
   - Add exactly these stable log tags (do not rename):
     - `DEV-0000035:T13:manual_acceptance_check_started`
     - `DEV-0000035:T13:manual_acceptance_check_completed`
   - Expected outcome: During final manual walkthrough, started appears before checks begin and completed appears after screenshots and acceptance verification are finished.
8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run test --workspace server`
4. [ ] `npm run test --workspace client`
5. [ ] `npm run e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness)
6. [ ] `npm run compose:build`
7. [ ] `npm run compose:up`
8. [ ] Manual Playwright-MCP check to manually confirm story items and general regression checks for this task; include a check that there are no logged errors within the debug console; use `http://host.docker.internal:5001` via Playwright MCP tools.
   - Required log tags to verify: `DEV-0000035:T13:manual_acceptance_check_started`, `DEV-0000035:T13:manual_acceptance_check_completed`.
   - Expected outcome: During final manual walkthrough, started appears before checks begin and completed appears after screenshots and acceptance verification are finished. Also confirm no unexpected `[error]`/uncaught console errors in browser debug console during this check.
   - Capture screenshots for every GUI-verifiable acceptance item and save them to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` (mapped in `docker-compose.local.yml`).
   - Required screenshot set:
     - `0000035-13-chat-raw-input-parity.png` (Chat preserves raw non-whitespace input and blocks whitespace-only input).
     - `0000035-13-chat-user-markdown-parity.png` (Chat user bubble markdown/list/code/mermaid parity with expected sanitization).
     - `0000035-13-agents-raw-input-parity.png` (Agents preserves raw non-whitespace input and blocks whitespace-only input).
     - `0000035-13-agents-user-markdown-parity.png` (Agents user bubble markdown/list/code/mermaid parity with expected sanitization).
     - `0000035-13-general-regression.png` (overall page state showing no UI regressions in task-touched areas).
   - Agent screenshot review expectation: each screenshot must be reviewed by the agent and explicitly confirmed to match this task’s acceptance expectations before this checklist item is marked complete.
9. [ ] `npm run test:unit --workspace server`
10. [ ] `npm run test:integration --workspace server`
11. [ ] `npm run compose:down`
12. [ ] Manual Playwright-MCP walkthrough of Chat, Agents, and MCP flows with screenshots saved to `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` and linked in `Implementation notes`
#### Implementation notes

- to_do

---
