# Story 0000025 - Smaller chunks and relevance cutoff

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Per request, this plan is created without tasks. Tasks will be added once the open questions are answered and the scope is confirmed.

---

## Description

Today, Codex input tokens are driven up by large vector-search payloads, especially when large files are chunked into big blocks and multiple chunks are returned. This makes Codex usage expensive even when the answer only needs a small slice of the repository.

We want to reduce Codex input tokens by applying a relevance cutoff so low-value chunks are not sent to Codex. The cutoff should default to distance <= 1.4 (lower is better), be overridable via environment variable, and still include the best 1–2 chunks even if nothing passes the cutoff. In addition, MCP responses for both chat and agents should return only the final answer (no reasoning or tool summaries) while preserving `conversationId` and `modelId`. The goal is to preserve answer quality while lowering token usage for typical queries, without introducing summary generation or embedding changes in this story.

We also need to correct the current “best match” aggregation logic for vector search summaries. We confirmed Chroma returns distance values (lower is better), but the current logic uses `Math.max` to compute “highest match,” which is backwards for distances and will misreport the best match (and would break any cutoff derived from that value). The fix is to treat distances as “lower is better” and compute the best match using `Math.min` instead of `Math.max` wherever the aggregated “best match” is derived.

---

## Acceptance Criteria

- A relevance cutoff is applied to vector search results so low-score chunks are not sent to Codex; default cutoff is distance <= 1.4 (lower is better), overridable via `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF`, and the best `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS` results (default 2) are still included even if none pass the cutoff.
- Cutoff bypass is supported: when `CODEINFO_RETRIEVAL_CUTOFF_DISABLED=true`, the cutoff is ignored and all results are eligible (still subject to payload caps).
- Tool payloads sent to Codex have a clear size cap: total tool output capped at ~40k characters via `CODEINFO_TOOL_MAX_CHARS` (default 40000) and each chunk capped by `CODEINFO_TOOL_CHUNK_MAX_CHARS` (default 5000); content beyond these limits is truncated or dropped so the cap is never exceeded, and the original ordering of the remaining chunks is preserved.
- MCP responses for `codebase_question` and agent `run_agent_instruction` return only the final answer text (no reasoning/summary segments) while still including `conversationId` and `modelId` in the JSON response payload.
- Vector search score semantics are confirmed: Chroma returns distances (lower is better, 0 is identical); cutoff logic uses `<=` on distance values and any “best match” aggregation uses the minimum distance, while preserving the order returned by Chroma.
- The vector search UI/tool details surface the distance value explicitly for each match entry when expanded (so users can see raw distance for each match).
- VectorSearch citations are deduplicated in two stages before being stored/displayed: (1) remove exact duplicates (same chunk id or identical chunk text), then (2) limit to the top 2 chunks per file by best distance (lowest) when more than 2 remain.
- Score-source logging remains enabled with the same tag/shape as today (no logging changes in this story).
- Documentation reflects the new retrieval strategy and any updated ingest behavior.

---

## Configuration Defaults

- `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF=1.4` (distance <= cutoff kept; lower is better).
- `CODEINFO_RETRIEVAL_CUTOFF_DISABLED=false` (when true, bypass the cutoff entirely).
- `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS=2` (best 1–2 chunks included even if none pass the cutoff).
- `CODEINFO_TOOL_MAX_CHARS=40000` (total tool output cap).
- `CODEINFO_TOOL_CHUNK_MAX_CHARS=5000` (per-chunk cap; within the 4–6k range).

---

## Research Notes

- Chroma query responses expose `distances` (and sometimes `scores`), where smaller numbers mean closer matches; we should preserve the ordering returned by the query response rather than re-sorting locally.
- The distance metric depends on the collection configuration (`l2`, `cosine`, or `ip`), and the HNSW `hnsw:space` metadata sets it at collection creation, so the cutoff must be treated as a distance threshold rather than a similarity score.
- Chroma’s default distance metric is L2 (squared Euclidean distance) per the Chroma cookbook; cosine distance is defined as `1 - cosine_similarity` (so lower is still better). The existing ingest flow does not set `hnsw:space`, so L2 remains the assumed default unless a future ingest change overrides it.
- Context7 snippets mention cosine as default in some examples; prefer the cookbook default (L2) and keep the cutoff configurable to handle metric differences.
- Deepwiki is not indexed for `Chargeuk/codeInfo2` yet, so repo insights came from the codebase and external docs.

---

## Implementation Ideas

- **Vector search cutoff + caps (server):**
  - `server/src/lmstudio/toolService.ts` → `vectorSearch()` should read the new env vars, apply the cutoff against `scores` (prefer `distances` when present), enforce the fallback count when no hits pass, and truncate or drop chunks to respect `CODEINFO_TOOL_MAX_CHARS` + `CODEINFO_TOOL_CHUNK_MAX_CHARS` while preserving the original result order.
  - `server/src/lmstudio/toolService.ts` → `aggregateVectorFiles()` should switch from `Math.max` to `Math.min` for `highestMatch` because lower distance is better.
  - `server/src/routes/toolsVectorSearch.ts` should log the effective cutoff/cap config for observability (or reuse existing vector score logging unchanged if that’s already sufficient).

- **Vector summary aggregation (MCP responder):**
  - `server/src/chat/responders/McpResponder.ts` → `buildVectorSummary()` should also use `Math.min` for `match` so the summary reflects the best (lowest) distance when aggregating result entries.

- **Citation dedupe rules (client):**
  - `client/src/hooks/useChatStream.ts` → after `extractCitations`, dedupe by chunk id or identical chunk text, then keep the top 2 chunks per file by lowest distance. Apply before assigning `assistantCitationsRef.current` so Chat + Agents UIs share the same deduped data.

- **Tool details UI (distance display):**
  - `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx` render vector file summaries using `highestMatch`. Update labels to explicitly say “Distance” (or “Lowest distance”) so it is clear lower values are better; keep formatting consistent with existing tool detail accordions.

- **MCP answer-only responses:**
  - `server/src/chat/responders/McpResponder.ts` + `server/src/mcp2/tools/codebaseQuestion.ts` should return only the final answer segment while still including `conversationId` + `modelId` in the JSON response. The MCP v1 router (`server/src/mcp/server.ts`) and Agents MCP (`server/src/mcpAgents/tools.ts`) should follow the same answer-only shape.

- **Tests/fixtures to update once tasks exist:**
  - `server/src/test/unit/tools-vector-search.test.ts` for cutoff/cap behavior and min-distance aggregation.
  - `client/src/test/chatPage.toolDetails.test.tsx` and `client/src/test/agentsPage.toolsUi.test.tsx` for distance label changes.
  - `client/src/test/useChatStream.toolPayloads.test.tsx` for citation dedupe (two-stage and top-2 per file).
  - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` and Agents MCP tests for answer-only response shape.

---

## Out Of Scope

- Changes to LM Studio runtime behavior or pricing strategy.
- Model-specific prompt engineering or new system prompt variants.
- External re-ranking services or third-party retrieval APIs.
- UI redesigns unrelated to retrieval or token usage.
- Changes to Codex thread history strategy.
- Summary generation, summary storage, or summary-only retrieval workflows.
- Adding a summariser provider/model selector to the ingest page.
- Expanding MCP responses beyond a single answer payload (reasoning, vector summaries, or tool call details).
- Any changes to embedding chunk size or overlap configuration.

---

## Questions

- None.

# Implementation Plan

## Instructions

These instructions will be followed once tasks are added. Tasks are intentionally omitted at this stage.

# Tasks

Tasks will be added later once the questions are resolved.
