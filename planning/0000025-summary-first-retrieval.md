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

- A relevance cutoff is applied to vector search results so low-score chunks are not sent to Codex; default cutoff is distance <= 1.4 (lower is better), overridable via environment variable, and the best 1–2 chunks are still included even if none pass the cutoff.
- Tool payloads sent to Codex have a clear size cap: total tool output capped at ~40k characters with a per-chunk cap in the 4–6k character range (configurable by environment variables) to prevent large tool outputs.
- MCP responses for `codebase_question` and agent `run_agent_instruction` return only the final answer text (no reasoning/summary segments) while still including `conversationId` and `modelId`.
- Vector search score semantics are confirmed: Chroma returns distances and lower is better; cutoff logic uses `<=` on distance values and any “best match” aggregation uses min.
- The vector search UI/tool details surface the distance value explicitly when expanded (so users can see raw distance for each match).
- VectorSearch citations are deduplicated in two stages before being stored/displayed: (1) remove exact duplicates (same chunk id or identical chunk text), then (2) limit to the top 2 chunks per file by best distance (lowest) when more than 2 remain.
- Score-source logging remains enabled (no change to existing logging).
- Documentation reflects the new retrieval strategy and any updated ingest behavior.

---

## Configuration Defaults

- `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF=1.4` (distance <= cutoff kept; lower is better).
- `CODEINFO_RETRIEVAL_CUTOFF_DISABLED=false` (when true, bypass the cutoff entirely).
- `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS=2` (best 1–2 chunks included even if none pass the cutoff).
- `CODEINFO_TOOL_MAX_CHARS=40000` (total tool output cap).
- `CODEINFO_TOOL_CHUNK_MAX_CHARS=5000` (per-chunk cap; within the 4–6k range).

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
