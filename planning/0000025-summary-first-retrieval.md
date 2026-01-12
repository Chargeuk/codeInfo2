# Story 0000025 - Summary-first retrieval and relevance cutoff

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Per request, this plan is created without tasks. Tasks will be added once the open questions are answered and the scope is confirmed.

---

## Description

Today, Codex input tokens are driven up by large vector-search payloads, especially when large files are chunked into big blocks and multiple chunks are returned. This makes Codex usage expensive even when the answer only needs a small slice of the repository.

We want to reduce Codex input tokens by shifting to summary-first retrieval, using smaller chunks for full-text retrieval, and applying a relevance cutoff so low-value chunks are not sent to Codex. The goal is to preserve answer quality while lowering token usage for typical queries. To support this, the ingest page should allow users to choose a summariser provider and model (similar to the chat provider/model selector), listed beneath the embedding model, so summaries can be generated with an explicit model choice.

---

## Acceptance Criteria

- Summary-first retrieval is the default for Codex tool usage, and full-text chunks are fetched only when summary results are insufficient.
- File summaries are generated during ingest and stored in a way that supports vector search without disrupting existing full-text embeddings.
- The ingest page exposes a summariser provider + model selector beneath the embedding model, following the same UX pattern as the chat provider/model selector.
- The summariser selection is stored with the ingest run metadata so summary generation is reproducible.
- A relevance cutoff is applied to vector search results so low-score chunks are not sent to Codex.
- Smaller full-text chunks are used for non-summary retrieval, with overlap tuned to avoid redundant token payloads.
- Tool payloads sent to Codex have a clear size cap (character or token budget) to prevent large tool outputs.
- Documentation reflects the new retrieval strategy and any new ingest artifacts.

---

## Out Of Scope

- Changes to LM Studio runtime behavior or pricing strategy.
- Model-specific prompt engineering or new system prompt variants.
- External re-ranking services or third-party retrieval APIs.
- UI redesigns unrelated to retrieval or token usage.
- Changes to Codex thread history strategy.
- Reworking the chat provider/model selector UX beyond reusing the pattern on the ingest page.

---

## Questions

- What summary size target should we use (per file) and how should we generate it (LM Studio embed model vs dedicated summarizer)?
- Should summaries be stored as separate "summary" chunks in the same collection, or in a separate collection?
- What relevance score cutoff should we apply, and is the score scale consistent for our Chroma setup?
- What should be the default chunk size and overlap for full-text chunks after this change?
- What is the maximum tool payload size we want to allow for Codex (chars/tokens), and should it be configurable?
- When summaries are insufficient, should we fetch full chunks for only the top file or top N files?
- Should we add a configurable toggle to bypass summary-first retrieval for certain queries?
- Which providers and model lists should be exposed for the summariser selector (LM Studio only, or include Codex if available)?
- Is the summariser selection required, or should summary generation be optional when no summariser is configured?

# Implementation Plan

## Instructions

These instructions will be followed once tasks are added. Tasks are intentionally omitted at this stage.

# Tasks

Tasks will be added later once the questions are resolved.
