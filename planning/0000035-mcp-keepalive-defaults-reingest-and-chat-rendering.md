# Story 0000035 - MCP keepalive/defaults, re-ingest MCP tools, Codex stream dedupe, and user markdown rendering

## Implementation Plan Instructions

This story follows `planning/plan_format_no_tasks.md`.

Follow `planning/plan_format_no_tasks.md` exactly for structure and intent while this story remains in discussion/scoping mode.

## Description

CodeInfo2 currently has a few related reliability and consistency gaps across MCP, chat, and agents UX.

On the MCP side, keepalive handling is duplicated across some servers and missing from others, so long-running tool calls are not handled consistently. Default chat provider/model behavior is also split across REST and MCP paths, which makes runtime behavior harder to predict unless model/provider are always explicitly supplied.

On tooling coverage, re-ingest is available via REST but not consistently exposed in the MCP surfaces where users already work, and we need a safe MCP-level re-ingest path that only allows re-ingesting repositories that are already known/ingested. The naming decision for this story is to use one canonical tool name on both MCP surfaces: `reingest_repository`.

On output correctness, after upgrading to `@openai/codex-sdk@0.101.0` (with `gpt-5.3-codex` usage), assistant output can appear cropped and duplicated in the web GUI around tool-call boundaries. This creates direct trust issues because final visible answers can be wrong even when the model execution was otherwise successful.

On chat/agents UX, user-authored text formatting is not rendered in user bubbles even though assistant text is markdown-rendered. Current send logic trims leading/trailing whitespace before sending to AI in both chat and agents paths, while interior whitespace/newlines are preserved. This story now fixes that policy to preserve full raw user input end-to-end with no trimming.

The target end state for this story is consistent MCP keepalive behavior, unified default provider/model resolution across REST and MCP, controlled MCP re-ingest support on both relevant MCP surfaces, corrected Codex stream assembly to prevent cropped/duplicate text, and user bubble markdown rendering that preserves intended formatting in both Chat and Agents pages. The defaulting decision for this story is explicit: only `CHAT_DEFAULT_PROVIDER` and `CHAT_DEFAULT_MODEL` are used as overrides, and when those env vars are absent the system defaults to provider `codex` and model `gpt-5.3-codex` for both REST chat and MCP `codebase_question`. Committed `.env` files are updated as part of this story to set those same values.

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
- Committed `.env` files used by normal and e2e server runs include `CHAT_DEFAULT_PROVIDER=codex` and `CHAT_DEFAULT_MODEL=gpt-5.3-codex`.
- Re-ingest is exposed as an MCP tool in both the MCP server that exposes chat/codebase-question and the MCP server that exposes vector/ingest tooling.
- The canonical MCP tool name is `reingest_repository` on both MCP surfaces.
- The `reingest_repository` request contract is `{"sourceId":"<containerPath>"}` and the response contract is `{"status":"started","runId":"...","sourceId":"...","operation":"reembed"}` (returned in each surface's existing MCP wrapper format).
- MCP re-ingest can only target repositories that are already present in ingested roots; it does not allow first-time ingest.
- `reingest_repository` validates `sourceId` with strict exact match against the known ingested root set (after normalization), and rejects non-string, empty, non-absolute, unknown, or ambiguous values.
- Codex streaming no longer produces cropped starts or duplicated final text in assistant bubbles for tool-interleaved responses.
- User message bubbles in both Chat and Agents render user content with the exact same markdown component and sanitization profile as assistant bubbles.
- User message bubbles support the same markdown feature set as assistant bubbles, including mermaid fenced blocks and existing sanitization behavior.
- User input sent to AI is preserved as full raw input with no trimming (including leading/trailing spaces and newlines) in both Chat and Agents flows.
- Send eligibility checks are aligned with raw-input preservation and no longer depend on `trim()`-based emptiness checks.
- Existing public contracts remain backward-compatible unless a contract change is explicitly agreed in this story.

## Out Of Scope

- Introducing brand-new ingest/start capabilities in MCP beyond re-ingest of existing repositories.
- Redesigning the broader chat/agents page layouts beyond user message rendering behavior.
- Reworking unrelated MCP tools or adding new MCP surfaces.
- Changing conversation persistence architecture or Mongo/Chroma schemas unless required to satisfy this story.
- General model-quality tuning unrelated to the concrete duplicate/cropped stream assembly bug.

## Questions

- For Codex stream handling, should progress/status messages ever appear in the final answer bubble, or must progress remain a separate channel only?
- What regression test matrix is required for the stream fix (minimum scenarios, providers, and UI paths) before we can mark the story scoped?

## Implementation Ideas

- Add shared keepalive helper(s) under `server/src/mcpCommon/` and adopt them in:
  - `server/src/mcp2/router.ts`
  - `server/src/mcpAgents/router.ts`
  - `server/src/mcp/server.ts`
- Introduce a shared chat defaults resolver (for provider/model) under `server/src/config/` and wire it into:
  - REST validation path in `server/src/routes/chatValidators.ts`
  - MCP codebase-question path in `server/src/mcp2/tools/codebaseQuestion.ts`
- Use only these env vars for provider/model overrides: `CHAT_DEFAULT_PROVIDER`, `CHAT_DEFAULT_MODEL`.
- Use this precedence for provider/model selection: explicit request value -> env override -> hardcoded fallback (`codex` / `gpt-5.3-codex`).
- Update committed server env defaults (`server/.env` and `server/.env.e2e`) to set:
  - `CHAT_DEFAULT_PROVIDER=codex`
  - `CHAT_DEFAULT_MODEL=gpt-5.3-codex`
- Add a shared re-ingest service wrapper around existing re-embed logic using current ingest primitives (`listIngestedRepositories` + `reembed`), with strict source validation against known ingested roots.
- Expose re-ingest tool in both MCP surfaces:
  - Canonical tool name on both surfaces: `reingest_repository`
  - Classic MCP router in `server/src/mcp/server.ts`
  - MCP v2 tools in `server/src/mcp2/tools.ts` (and tool definition module)
  - Shared request: `sourceId` only
  - Shared payload result: `status`, `runId`, `sourceId`, `operation: "reembed"`
- Enforce strict source authorization/safety rules for `reingest_repository`:
  - Accept `sourceId` only when it exactly matches an existing ingested root after normalization.
  - Reject non-string, empty, non-absolute, unknown, and ambiguous `sourceId` values.
  - Re-check root existence at execution time (not only at tool discovery/list time).
- Fix Codex output assembly in `server/src/chat/interfaces/ChatInterfaceCodex.ts` to handle non-monotonic updates safely (tool-call boundary aware, no append-on-divergence behavior).
- Align bridge/finalization behavior in `server/src/chat/chatStreamBridge.ts` and `server/src/chat/inflightRegistry.ts` so non-prefix final text does not duplicate already-streamed content.
- Update user-bubble rendering in:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/pages/AgentsPage.tsx`
  to render user text via the exact same `Markdown` component path used for assistant text.
- Implement raw user-input preservation (no trim) in:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/hooks/useChatStream.ts`
  - `client/src/pages/AgentsPage.tsx`
  including submit guards and send-button disabled checks.
- Add focused tests for:
  - MCP keepalive coverage across routers
  - shared default resolution and fallback behavior
  - MCP re-ingest validation (existing repo allowed, unknown repo rejected)
  - Codex stream non-prefix/truncation/tool-boundary cases
  - chat/agents user markdown rendering parity with assistant markdown (including mermaid handling)
  - chat/agents raw-input send behavior with leading/trailing whitespace and newline-only payloads
