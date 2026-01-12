# Story 0000025 - Smaller chunks and relevance cutoff

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Per request, this plan is created without tasks. Tasks will be added once the open questions are answered and the scope is confirmed.

---

## Description

Today, Codex input tokens are driven up by large vector-search payloads, especially when large files are chunked into big blocks and multiple chunks are returned. This makes Codex usage expensive even when the answer only needs a small slice of the repository.

We want to reduce Codex input tokens by using smaller chunks for full-text retrieval and applying a relevance cutoff so low-value chunks are not sent to Codex. In addition, MCP responses for both chat and agents should return only the final answer (no reasoning or tool summaries) to avoid extra tokens. The goal is to preserve answer quality while lowering token usage for typical queries, without introducing summary generation in this story.

We also need to correct the current “best match” aggregation logic for vector search summaries. We confirmed Chroma returns distance values (lower is better), but the current logic uses `Math.max` to compute “highest match,” which is backwards for distances and will misreport the best match (and would break any cutoff derived from that value). The fix is to treat distances as “lower is better” and compute the best match using `Math.min` instead of `Math.max` wherever the aggregated “best match” is derived.

---

## Acceptance Criteria

- A relevance cutoff is applied to vector search results so low-score chunks are not sent to Codex.
- Smaller full-text chunks are used for retrieval, with overlap tuned to avoid redundant token payloads.
- Tool payloads sent to Codex have a clear size cap (character or token budget) to prevent large tool outputs.
- MCP responses for `codebase_question` and agent `run_agent_instruction` return only the final answer text (no reasoning/summary segments).
- Vector search score semantics are confirmed: Chroma returns distances and lower is better; cutoff logic uses `<=` on distance values and any “best match” aggregation uses min.
- The vector search UI/tool details surface the distance value explicitly when expanded (so users can see raw distance for each match).
- Documentation reflects the new retrieval strategy and any updated ingest behavior.

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

---

## Questions

- What relevance score cutoff should we apply for distance values (e.g., 1.4–1.6 based on observed ranges)?
- What should be the default chunk size and overlap for full-text chunks after this change?
- What is the maximum tool payload size we want to allow for Codex (chars/tokens), and should it be configurable?
- Should we add a configurable toggle to bypass the relevance cutoff for debugging?
- Should MCP answer-only responses still include `conversationId`/`modelId`, or should they return just the answer text?
- Do we need a backward-compatibility switch for existing MCP clients expecting `segments`?
- Should we keep the score-source logging after rollout or remove it once the cutoff is tuned?

# Implementation Plan

## Instructions

These instructions will be followed once tasks are added. Tasks are intentionally omitted at this stage.

# Tasks

Tasks will be added later once the questions are resolved.
