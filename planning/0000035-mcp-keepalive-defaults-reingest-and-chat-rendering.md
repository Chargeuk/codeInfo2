# Story 0000035 - MCP keepalive/defaults, re-ingest MCP tools, Codex stream dedupe, and user markdown rendering

## Implementation Plan Instructions

This story follows `planning/plan_format_no_tasks.md`.

Follow `planning/plan_format_no_tasks.md` exactly for structure and intent while this story remains in discussion/scoping mode.

## Description

CodeInfo2 currently has a few related reliability and consistency gaps across MCP, chat, and agents UX.

On the MCP side, keepalive handling is duplicated across some servers and missing from others, so long-running tool calls are not handled consistently. Default chat provider/model behavior is also split across REST and MCP paths, which makes runtime behavior harder to predict unless model/provider are always explicitly supplied.

On tooling coverage, re-ingest is available via REST but not consistently exposed in the MCP surfaces where users already work, and we need a safe MCP-level re-ingest path that only allows re-ingesting repositories that are already known/ingested.

On output correctness, after upgrading to `@openai/codex-sdk@0.101.0` (with `gpt-5.3-codex` usage), assistant output can appear cropped and duplicated in the web GUI around tool-call boundaries. This creates direct trust issues because final visible answers can be wrong even when the model execution was otherwise successful.

On chat/agents UX, user-authored text formatting is not rendered in user bubbles even though assistant text is markdown-rendered. In addition, current send logic trims leading/trailing whitespace before sending to AI, while interior whitespace/newlines are preserved; we need to confirm and agree whether this behavior should remain or be changed.

The target end state for this story is consistent MCP keepalive behavior, unified default provider/model resolution across REST and MCP (with safe fallback to current behavior), controlled MCP re-ingest support on both relevant MCP surfaces, corrected Codex stream assembly to prevent cropped/duplicate text, and user bubble markdown rendering that preserves intended formatting in both Chat and Agents pages.

## Acceptance Criteria

- MCP keepalive behavior is implemented via shared common logic and used consistently across all MCP servers that can run long-lived tool calls.
- The default provider/model can be configured in `.env` and is applied consistently in both REST and MCP interfaces.
- If new `.env` defaults are missing or invalid, behavior falls back to current defaults without breaking existing clients.
- Re-ingest is exposed as an MCP tool in both the MCP server that exposes chat/codebase-question and the MCP server that exposes vector/ingest tooling.
- MCP re-ingest can only target repositories that are already present in ingested roots; it does not allow first-time ingest.
- Codex streaming no longer produces cropped starts or duplicated final text in assistant bubbles for tool-interleaved responses.
- User message bubbles in both Chat and Agents render user content as markdown (same user-visible formatting style goal as assistant markdown rendering).
- The team explicitly confirms expected whitespace behavior for payloads sent to AI (including whether leading/trailing whitespace should continue to be trimmed).
- Existing public contracts remain backward-compatible unless a contract change is explicitly agreed in this story.

## Out Of Scope

- Introducing brand-new ingest/start capabilities in MCP beyond re-ingest of existing repositories.
- Redesigning the broader chat/agents page layouts beyond user message rendering behavior.
- Reworking unrelated MCP tools or adding new MCP surfaces.
- Changing conversation persistence architecture or Mongo/Chroma schemas unless required to satisfy this story.
- General model-quality tuning unrelated to the concrete duplicate/cropped stream assembly bug.

## Questions

- Which exact env variable names and precedence order should be authoritative for shared provider/model defaults? (for example: global default plus provider-specific overrides)
- Should REST continue to default provider to `lmstudio` and MCP `codebase_question` continue to default provider to `codex` when env defaults are absent, or should both interfaces share one provider fallback?
- For whitespace handling, should leading/trailing whitespace continue to be trimmed before send, or should raw user input (including leading/trailing newlines) be preserved end-to-end?
- For user markdown rendering, should user bubbles use the exact same markdown component and sanitization profile as assistant bubbles, or a restricted variant?
- Should user markdown rendering include advanced blocks (for example mermaid fences) or only standard markdown formatting?
- For re-ingest MCP tooling, what should the canonical tool name and response contract be on each MCP surface?
- For re-ingest authorization/safety, are there any additional constraints beyond "existing ingested repos only" (for example allowed sourceId forms, path normalization rules)?
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
- Keep fallback compatibility explicit in resolver logic so existing behavior remains when env values are missing/invalid.
- Add a shared re-ingest service wrapper around existing re-embed logic using current ingest primitives (`listIngestedRepositories` + `reembed`), with strict source validation against known ingested roots.
- Expose re-ingest tool in both MCP surfaces:
  - Classic MCP router in `server/src/mcp/server.ts`
  - MCP v2 tools in `server/src/mcp2/tools.ts` (and tool definition module)
- Fix Codex output assembly in `server/src/chat/interfaces/ChatInterfaceCodex.ts` to handle non-monotonic updates safely (tool-call boundary aware, no append-on-divergence behavior).
- Align bridge/finalization behavior in `server/src/chat/chatStreamBridge.ts` and `server/src/chat/inflightRegistry.ts` so non-prefix final text does not duplicate already-streamed content.
- Update user-bubble rendering in:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/pages/AgentsPage.tsx`
  to render user text via markdown renderer (or agreed safe variant), preserving visible formatting.
- Confirm and then implement final whitespace-send policy in:
  - `client/src/pages/ChatPage.tsx`
  - `client/src/hooks/useChatStream.ts`
  - `client/src/pages/AgentsPage.tsx`
  - `client/src/api/agents.ts`
- Add focused tests for:
  - MCP keepalive coverage across routers
  - shared default resolution and fallback behavior
  - MCP re-ingest validation (existing repo allowed, unknown repo rejected)
  - Codex stream non-prefix/truncation/tool-boundary cases
  - chat/agents user markdown rendering and whitespace expectations
