# Story 0000025 - Smaller chunks and relevance cutoff

## Implementation Plan Instructions

This story follows `planning/plan_format.md`.

Follow `planning/plan_format.md` (update Task Status before coding; work tasks in order; run required tests; update docs; record commits; push at each stage).

Story convention (important for this repo’s planning style):

- Each task’s **Documentation Locations** section must contain **external** references only (website docs, Context7 library docs, MUI MCP docs, Deepwiki MCP docs when available).
- Any repo file paths that must be read/edited belong in the relevant **Subtask** under “Files to read” / “Files to edit”.

---

## Description

Today, Codex input tokens are driven up by large vector-search payloads, especially when large files are chunked into big blocks and multiple chunks are returned. This makes Codex usage expensive even when the answer only needs a small slice of the repository.

We want to reduce Codex input tokens by applying a relevance cutoff so low-value chunks are not sent to Codex. The cutoff should default to distance <= 1.4 (lower is better), be overridable via environment variable, and still include the best 1–2 chunks even if nothing passes the cutoff. In addition, MCP responses for both chat and agents should return only the final answer (no reasoning or tool summaries) while preserving `conversationId` and `modelId`. The goal is to preserve answer quality while lowering token usage for typical queries, without introducing summary generation or embedding changes in this story.

We also need to correct the current “best match” aggregation logic for vector search summaries. We confirmed Chroma returns distance values (lower is better), but the current logic uses `Math.max` to compute “highest match,” which is backwards for distances and will misreport the best match (and would break any cutoff derived from that value). The fix is to treat distances as “lower is better” and compute the best match using `Math.min` instead of `Math.max` wherever the aggregated “best match” is derived.

---

## Acceptance Criteria

- A relevance cutoff is applied to vector search results so low-score chunks are not sent to Codex; default cutoff is distance <= 1.4 (lower is better), overridable via `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF`, and the best `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS` results (default 2, best = lowest distance with original-order tie-breaks) are still included even if none pass the cutoff.
- Cutoff bypass is supported: when `CODEINFO_RETRIEVAL_CUTOFF_DISABLED=true`, the cutoff is ignored and all results are eligible (still subject to payload caps).
- Tool payloads sent to Codex have a clear size cap: total tool output capped at ~40k characters via `CODEINFO_TOOL_MAX_CHARS` (default 40000) and each chunk capped by `CODEINFO_TOOL_CHUNK_MAX_CHARS` (default 5000). The limits apply to the `chunk` text length only; total size is computed as the sum of per-chunk text lengths after truncation. Content beyond these limits is truncated or dropped so the cap is never exceeded, and the original ordering of the remaining chunks is preserved.
- MCP responses for `codebase_question` and agent `run_agent_instruction` return only the final answer text (no reasoning/summary segments) while still including `conversationId` and `modelId` in the JSON response payload.
- Vector search score semantics are confirmed: Chroma returns distances (lower is better, 0 is identical); cutoff logic uses `<=` on distance values and any “best match” aggregation uses the minimum distance, while preserving the order returned by Chroma.
- The vector search UI/tool details surface the distance value explicitly for each match entry when expanded (so users can see raw distance for each match).
- VectorSearch citations are deduplicated in two stages before being stored/displayed: (1) remove exact duplicates (same chunk id or identical chunk text), then (2) limit to the top 2 chunks per file by best distance (lowest) when more than 2 remain. File identity should be `repo + relPath`, ties keep the earliest item in the original results order, and entries with missing distances are treated as lowest priority (only included via fallback if needed).
- Score-source logging remains enabled with the same tag/shape as today (no logging changes in this story).
- Documentation reflects the new retrieval strategy (cutoff, caps, answer-only MCP) in `design.md`, and `README.md` is updated only if any user-facing behavior or commands change.

---

## Configuration Defaults

- `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF=1.4` (distance <= cutoff kept; lower is better).
- `CODEINFO_RETRIEVAL_CUTOFF_DISABLED=false` (when true, bypass the cutoff entirely).
- `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS=2` (best 1–2 chunks included even if none pass the cutoff).
- `CODEINFO_TOOL_MAX_CHARS=40000` (total tool output cap).
- `CODEINFO_TOOL_CHUNK_MAX_CHARS=5000` (per-chunk cap; within the 4–6k range).

---

## Message Contracts & Storage Shapes (planned)

- **VectorSearch tool response (HTTP + LM Studio tool):** no new fields; same shape as today (`results[]` with `repo`, `relPath`, `containerPath`, `hostPath`, `score`, `chunk`, `chunkId`, `modelId`, `lineCount`; plus `modelId` and `files[]` with `highestMatch`, `chunkCount`, `lineCount`). Changes are semantic only: results may be filtered by cutoff, truncated by size caps, and `highestMatch` represents the **lowest** distance after aggregation.
- **MCP v2 `codebase_question` response:** currently returns JSON `{ conversationId, modelId, segments[] }` (segments include `thinking`, `vector_summary`, `answer`). This story narrows MCP output to **answer-only** by returning `segments: [{ type: 'answer', text }]` while still including `conversationId` and `modelId`.
- **Agents MCP `run_agent_instruction` response:** currently returns JSON `{ agentName, conversationId, modelId, segments[] }` (segments include thinking/summary/answer). For MCP only, return the same wrapper but restrict `segments` to a single `{ type: 'answer', text }` entry.
- **MCP v1 (`/mcp`)** has no `codebase_question` tool today and does not need contract changes for this story.
- **Storage shapes:** no Mongo schema changes are required; ingest metadata, turns, tool payloads, and citations keep their existing schemas. Citation dedupe happens client-side before rendering and is not persisted.

---

## Research Notes

- Chroma query responses expose `distances` (and sometimes `scores`), where smaller numbers mean closer matches; we should preserve the ordering returned by the query response rather than re-sorting locally.
- The distance metric depends on the collection configuration (`l2`, `cosine`, or `ip`), and the HNSW `hnsw:space` metadata sets it at collection creation (cannot be changed after creation), so the cutoff must be treated as a distance threshold rather than a similarity score.
- Chroma’s default distance metric is L2 (squared Euclidean distance) per the Chroma cookbook; cosine distance is defined as `1 - cosine_similarity` (so lower is still better). The existing ingest flow does not set `hnsw:space`, so L2 remains the assumed default unless a future ingest change overrides it.
- Context7 snippets mention cosine as default in some examples; prefer the cookbook default (L2) and keep the cutoff configurable to handle metric differences.
- Deepwiki is not indexed for `Chargeuk/codeInfo2` yet, so repo insights came from the codebase and external docs.

---

## Implementation Ideas

- **Vector search cutoff + caps (server):**
  - `server/src/lmstudio/toolService.ts` → `vectorSearch()` should read the new env vars, apply the cutoff against `scores` (prefer `distances` when present), enforce the fallback count when no hits pass, and truncate or drop chunks to respect `CODEINFO_TOOL_MAX_CHARS` + `CODEINFO_TOOL_CHUNK_MAX_CHARS` while preserving the original result order.
  - `server/src/lmstudio/toolService.ts` → `aggregateVectorFiles()` should switch from `Math.max` to `Math.min` for `highestMatch` because lower distance is better.
  - Preserve existing score-source logging; do not add new log tags for cutoff/caps in this story.

- **Vector summary aggregation (MCP responder):**
  - `server/src/chat/responders/McpResponder.ts` → `buildVectorSummary()` should also use `Math.min` for `match` so the summary reflects the best (lowest) distance when aggregating result entries.

- **Citation dedupe rules (client):**
  - `client/src/hooks/useChatStream.ts` → after `extractCitations`, dedupe by chunk id or identical chunk text, then keep the top 2 chunks per file by lowest distance. Apply before assigning `assistantCitationsRef.current` so Chat + Agents UIs share the same deduped data.

- **Tool details UI (distance display):**
  - `client/src/pages/ChatPage.tsx` and `client/src/pages/AgentsPage.tsx` render vector file summaries using `highestMatch`. Update labels to explicitly say “Distance” (or “Lowest distance”) so it is clear lower values are better; keep formatting consistent with existing tool detail accordions.

- **MCP answer-only responses:**
  - `server/src/chat/responders/McpResponder.ts` + `server/src/mcp2/tools/codebaseQuestion.ts` should return only the final answer segment while still including `conversationId` + `modelId` in the JSON response.
  - `server/src/mcpAgents/tools.ts` should restrict `run_agent_instruction` responses to the same answer-only `segments` shape.
  - MCP v1 (`server/src/mcp/server.ts`) does not expose `codebase_question`, so it should not be touched for this change.

- **Tests/fixtures to update once tasks exist:**
  - `server/src/test/unit/tools-vector-search.test.ts` for cutoff/cap behavior and min-distance aggregation.
  - `client/src/test/chatPage.toolDetails.test.tsx` and `client/src/test/agentsPage.toolsUi.test.tsx` for distance label changes.
  - `client/src/test/useChatStream.toolPayloads.test.tsx` for citation dedupe (two-stage and top-2 per file).
  - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts` and Agents MCP tests for answer-only response shape.

---

## Edge Cases and Failure Modes

- **No vector results returned:** ensure cutoff logic still returns an empty `results` array without throwing, and the fallback does not fabricate data.
- **All scores missing or non-numeric:** cutoff should be skipped (or treat all as ineligible) but still allow fallback to the best 1–2 chunks based on original order; `highestMatch` stays `null`.
- **Scores present but cutoff excludes all:** fallback should still include the best `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS` results in original order.
- **Payload cap too small to include any chunk:** if `CODEINFO_TOOL_MAX_CHARS` is below the smallest chunk after per-chunk truncation, return zero chunks and log the existing vector score source line only (no new log tags).
- **Missing `relPath` or `repo` in tool payload:** citation dedupe should ignore malformed items rather than crashing; tool details UI should still render available entries.
- **Duplicate chunk text across different files:** dedupe step 1 should only collapse duplicates within the same `repo + relPath` bucket (so different files can still appear).
- **MCP response shape mismatch:** MCP clients that still expect `thinking`/`vector_summary` should continue to parse the JSON but only see a single `answer` segment; ensure they don’t break on missing segment types.
- **Archived conversations (MCP/agents):** keep existing error behavior when a conversation is archived; the answer-only change must not alter error codes or statuses.

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

These instructions will be followed during implementation.

# Tasks

### 1. Server: MCP answer-only responses for codebase_question + agents

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Return answer-only segments for MCP `codebase_question` and agent `run_agent_instruction` responses while preserving `conversationId` and `modelId`. This keeps client parsing simple and ensures response payloads exclude reasoning and vector-summary segments without changing error handling.

#### Documentation Locations

- JSON-RPC 2.0 specification (response shape + result object): https://www.jsonrpc.org/specification
- Node.js JSON serialization basics (`JSON.stringify`, `res.json` expectations): https://nodejs.org/api/json.html
- Node.js `AbortController` + error handling patterns (reference for existing patterns, no changes): https://nodejs.org/api/globals.html#class-abortcontroller

#### Subtasks

1. [ ] Review current MCP response assembly for codebase_question and agents:
   - Documentation to read (repeat):
     - JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
   - Recap (acceptance criteria): return only the final answer segment while keeping `conversationId` and `modelId` unchanged.
   - Files to read:
     - `server/src/chat/responders/McpResponder.ts`
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/mcp2/server.ts`
     - `server/src/mcpAgents/tools.ts`
     - `server/src/agents/service.ts`
     - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
     - `server/src/test/unit/mcp-agents-tools.test.ts`
     - `server/src/test/unit/mcp-agents-router-run.test.ts`
     - `server/src/test/integration/mcp-codex-wrapper.test.ts`
     - `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`
   - Goal:
     - Identify where `segments` arrays are built and how answer content is extracted.

2. [ ] Update `codebase_question` tool response to return only the answer segment:
   - Files to edit:
     - `server/src/mcp2/tools/codebaseQuestion.ts`
   - Requirements:
     - Keep `conversationId` and `modelId` in the JSON response payload.
     - Replace multi-segment payloads with a single `answer` segment (final answer text only).
     - Preserve error handling for archived conversations and tool failures.

3. [ ] Update MCP responder to emit answer-only segments:
   - Files to edit:
     - `server/src/chat/responders/McpResponder.ts`
   - Requirements:
     - Ensure `buildVectorSummary()` output is not included in MCP responses.
     - Keep the segment structure consistent (type + text) but only for the final answer.

4. [ ] Update MCP tool definitions to reflect answer-only responses:
   - Files to edit:
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/mcpAgents/tools.ts`
   - Requirements:
     - Update description strings to remove “thinking/vector_summary” language.
     - Keep input schemas unchanged.

5. [ ] Update agent MCP tooling to mirror answer-only responses:
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Requirements:
     - Ensure `run_agent_instruction` responses return only the final answer segment.
     - Preserve `conversationId` + `modelId` fields and existing status/error codes.

6. [ ] Update MCP tests/fixtures for the new response shape:
   - Files to edit:
     - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
     - `server/src/test/unit/mcp-agents-tools.test.ts`
     - `server/src/test/unit/mcp-agents-router-run.test.ts`
     - `server/src/test/integration/mcp-codex-wrapper.test.ts`
     - `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`
   - Requirements:
     - Assert that `segments` contains exactly one `answer` entry (where segments remain).
     - Confirm no `thinking` or `vector_summary` segments appear.

7. [ ] Documentation update - `design.md` (only if response contracts are documented):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: add or adjust MCP response shape notes only if the design section currently mentions multi-segment MCP payloads.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Note the answer-only MCP response shape for `codebase_question` and agents.
   - Purpose: Keep MCP contract documentation accurate.

8. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`; fix issues before continuing.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run test:unit --workspace server`

#### Implementation notes

- Notes added during implementation.

---

### 2. Server: distance semantics for vector aggregations (min distance)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Switch vector “best match” aggregation to use minimum distance values (lower is better) across tool aggregation and MCP vector summaries. This keeps reported matches consistent with Chroma’s distance semantics and prevents future cutoff logic from using inverted values.

#### Documentation Locations

- ChromaDB query result semantics (distance is lower-is-better): https://docs.trychroma.com/
- JavaScript `Math.min` behavior (null/undefined handling): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/min
- Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Review current vector aggregation logic and tests:
   - Documentation to read (repeat):
     - ChromaDB docs: https://docs.trychroma.com/
   - Recap (acceptance criteria): “best match” must be the minimum distance, and ordering stays as returned by Chroma.
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
     - `server/src/chat/responders/McpResponder.ts`
     - `server/src/test/unit/tools-vector-search.test.ts`
     - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Goal:
     - Locate `Math.max` usage and determine how `highestMatch` is reported.

2. [ ] Update vector file aggregation to use minimum distance:
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Replace `Math.max` with `Math.min` when computing `highestMatch` for each file.
     - Keep `highestMatch` `null` if no numeric distances exist.
     - Preserve result ordering and existing score-source logging.

3. [ ] Update MCP vector summary aggregation to use minimum distance:
   - Files to edit:
     - `server/src/chat/responders/McpResponder.ts`
   - Requirements:
     - Ensure summary `match` uses the lowest distance across entries.
     - Preserve current summary ordering and shape.

4. [ ] Update server tests for min-distance semantics:
   - Files to edit:
     - `server/src/test/unit/tools-vector-search.test.ts`
     - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Requirements:
     - Add/adjust assertions so the best match is the smallest distance.
     - Cover mixed numeric + missing scores to ensure `null` remains when appropriate.

5. [ ] Documentation update - `design.md` (if it documents “highest match” semantics):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: clarify that “best match” reflects the lowest distance.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update wording around vector “best match” aggregation.
   - Purpose: Keep retrieval semantics aligned with Chroma distance.

6. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`; fix issues before continuing.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run test:unit --workspace server`

#### Implementation notes

- Notes added during implementation.

---

### 3. Server: retrieval cutoff + fallback selection

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Introduce distance-based cutoff logic for vector search results with an env-configured threshold and fallback selection. This ensures only relevant chunks are sent to Codex while still including the best 1–2 chunks when no items pass the cutoff.

#### Documentation Locations

- Node.js `process.env` (environment variable defaults): https://nodejs.org/api/process.html#processenv
- ChromaDB query result semantics (distance is lower-is-better): https://docs.trychroma.com/
- JavaScript array sort and stable ordering references: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort

#### Subtasks

1. [ ] Review vector search tool flow and existing env usage:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Recap (acceptance criteria): default cutoff `<= 1.4`, cutoff bypass flag, fallback to best 1–2 chunks when no items pass.
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
     - `server/src/config.ts`
     - `server/src/test/unit/tools-vector-search.test.ts`
   - Goal:
     - Identify where scores/distances are read and how tool output is assembled.

2. [ ] Add env-driven cutoff configuration:
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Read `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF`, `CODEINFO_RETRIEVAL_CUTOFF_DISABLED`, and `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS` with defaults.
     - Parse numeric values safely; treat invalid values as default.
     - Keep existing score-source logging unchanged.

3. [ ] Apply cutoff and fallback selection in vectorSearch:
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Filter results using `distance <= cutoff` when cutoff is enabled.
     - When cutoff is disabled, keep all results eligible for downstream caps.
     - When no entries pass, include the best `fallback` chunks (lowest distance, original-order tie-break).
     - Preserve the original ordering of retained results.
     - Treat missing/non-numeric distances as lowest priority for cutoff + fallback.

4. [ ] Update unit tests for cutoff and fallback behavior:
   - Files to edit:
     - `server/src/test/unit/tools-vector-search.test.ts`
   - Requirements:
     - Add cases for cutoff enabled, cutoff disabled, and fallback when none pass.
     - Cover empty result sets and all-missing distance values.
     - Cover missing distance handling and tie-break ordering.

5. [ ] Update server `.env` with retrieval cutoff defaults:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Recap: document cutoff, bypass flag, and fallback defaults for local runs.
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Add commented defaults for `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF`, `CODEINFO_RETRIEVAL_CUTOFF_DISABLED`, and `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS`.
     - Keep existing env ordering and comment style.

6. [ ] Documentation update - `design.md` (retrieval cutoff + fallback):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document cutoff, fallback defaults, and bypass flag.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Add retrieval cutoff + fallback behavior to the retrieval section.
   - Purpose: Keep retrieval strategy documentation accurate.

7. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`; fix issues before continuing.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run test:unit --workspace server`

#### Implementation notes

- Notes added during implementation.

---

### 4. Server: tool payload size caps (total + per-chunk)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Enforce tool payload caps for Codex retrieval by limiting per-chunk text length and total tool output size. This ensures the tool payload never exceeds configured character limits while keeping result order intact.

#### Documentation Locations

- Node.js `process.env` (environment variable defaults): https://nodejs.org/api/process.html#processenv
- JavaScript `String.prototype.slice` (truncation behavior): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice
- Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html

#### Subtasks

1. [ ] Review vector search payload construction and existing test coverage:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Recap (acceptance criteria): total tool output capped at `CODEINFO_TOOL_MAX_CHARS`, per-chunk capped at `CODEINFO_TOOL_CHUNK_MAX_CHARS`.
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
     - `server/src/test/unit/tools-vector-search.test.ts`
   - Goal:
     - Locate where chunks are assembled and where size counting can be applied.

2. [ ] Add env-driven cap configuration:
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Read `CODEINFO_TOOL_MAX_CHARS` and `CODEINFO_TOOL_CHUNK_MAX_CHARS` with defaults.
     - Parse numeric values safely; treat invalid values as defaults.

3. [ ] Apply per-chunk truncation and total payload cap:
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Truncate each chunk text to the per-chunk cap before counting total size.
     - Drop additional chunks once total size would exceed the max.
     - Preserve original ordering of the retained chunks.
     - Ensure zero chunks are returned if the total cap is too small to include any truncated chunk.

4. [ ] Update unit tests for payload caps:
   - Files to edit:
     - `server/src/test/unit/tools-vector-search.test.ts`
   - Requirements:
     - Add cases for per-chunk truncation and total cap enforcement.
     - Include a case where the max cap is too small and results become empty.

5. [ ] Update server `.env` with tool cap defaults:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Recap: document total and per-chunk cap defaults for local runs.
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Add commented defaults for `CODEINFO_TOOL_MAX_CHARS` and `CODEINFO_TOOL_CHUNK_MAX_CHARS`.
     - Keep existing env ordering and comment style.

6. [ ] Documentation update - `design.md` (tool payload caps):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document total/per-chunk cap defaults and truncation behavior.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Add tool payload size caps to retrieval strategy notes.
   - Purpose: Keep tool payload documentation accurate.

7. [ ] Run `npm run lint --workspace server` and `npm run format:check --workspace server`; fix issues before continuing.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run test:unit --workspace server`

#### Implementation notes

- Notes added during implementation.

---

### 5. Client: citation dedupe rules (two-stage + top-2 per file)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Deduplicate VectorSearch citations on the client by removing exact duplicates per file and limiting to the top 2 chunks per file by lowest distance. This keeps citation displays concise and consistent with the retrieval strategy.

#### Documentation Locations

- MDN `Map` (keyed grouping for file buckets): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
- MDN `Array.prototype.sort` (stable ordering and tie-breaks): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
- Jest expect API (assertions for tool payloads): https://jestjs.io/docs/expect
- Testing Library React docs (component-level testing utilities): https://testing-library.com/docs/react-testing-library/intro/

#### Subtasks

1. [ ] Review citation extraction flow and existing tests:
   - Documentation to read (repeat):
     - MDN `Map`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
   - Recap (acceptance criteria): dedupe exact duplicates (same chunk id or identical chunk text) per file, then keep top 2 per file by lowest distance.
   - Files to read:
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Goal:
     - Identify where `extractCitations` output is assigned to `assistantCitationsRef`.

2. [ ] Implement two-stage citation dedupe and per-file top-2 filtering:
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Stage 1: remove duplicates by chunk id or identical chunk text **within the same `repo + relPath` bucket**.
     - Stage 2: if more than 2 remain per file, keep the 2 with lowest distance (tie-break by original order).
     - Treat missing/non-numeric distances as lowest priority (only included when needed for fallback).
     - Apply before assigning `assistantCitationsRef.current` so Chat + Agents share the same data.

3. [ ] Update client tests for citation dedupe rules:
   - Files to edit:
     - `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Requirements:
     - Add cases for duplicate chunk ids, duplicate chunk text in same file, and duplicate text across different files (keep both files).
     - Validate top-2 per file selection based on lowest distance with original-order tie-breaks.
     - Add coverage for malformed citations missing `repo` or `relPath` (ignored without crashing).

4. [ ] Documentation update - `design.md` (citation dedupe rules):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document two-stage dedupe + top-2 per file rule.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Add citation dedupe rules to the retrieval strategy notes.
   - Purpose: Keep client citation behavior documented.

5. [ ] Run `npm run lint --workspace client` and `npm run format:check --workspace client`; fix issues before continuing.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run test --workspace client`

#### Implementation notes

- Notes added during implementation.

---

### 6. Client: tool details show distance labels + per-match distances

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Update Chat and Agents tool detail panels to explicitly label distance values and surface per-match distances when expanded. This clarifies that lower distances are better and makes raw score inspection easy for users.

#### Documentation Locations

- MUI Accordion (expandable tool details): https://llms.mui.com/material-ui/6.4.12/components/accordion.md
- MUI Typography (label text + value formatting): https://llms.mui.com/material-ui/6.4.12/components/typography.md
- MUI Stack (layout + spacing): https://llms.mui.com/material-ui/6.4.12/components/stack.md
- Testing Library React docs (component testing patterns): https://testing-library.com/docs/react-testing-library/intro/
- Jest expect API (assertions for UI output): https://jestjs.io/docs/expect

#### Subtasks

1. [ ] Review current tool detail rendering for vector search entries:
   - Documentation to read (repeat):
     - MUI Accordion: https://llms.mui.com/material-ui/6.4.12/components/accordion.md
   - Recap (acceptance criteria): show explicit “Distance” labels and per-match distance values when expanded.
   - Files to read:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/chatPage.toolDetails.test.tsx`
     - `client/src/test/agentsPage.toolsUi.test.tsx`
   - Goal:
     - Identify the vector tool detail blocks and where tool payload `results` are available for per-match display.

2. [ ] Update tool detail UI labels for distance values:
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
     - Replace ambiguous “Match” labels with “Distance” or “Lowest distance.”
     - Display per-match distance values alongside each chunk in expanded tool details.
     - Render per-match rows from tool payload `results` (not just file summaries), including the distance value and chunk preview.
     - Skip or gracefully handle entries missing `repo` or `relPath` without breaking the tool panel.
     - Keep formatting consistent with existing tool detail accordions.

3. [ ] Update client UI tests for distance label changes:
   - Files to edit:
     - `client/src/test/chatPage.toolDetails.test.tsx`
     - `client/src/test/agentsPage.toolsUi.test.tsx`
   - Requirements:
     - Assert that labels explicitly mention “Distance”.
     - Verify per-match distance values render when the tool details expand.
     - Validate per-match rows render from tool payload `results`.
     - Cover entries missing `repo` or `relPath` to ensure the panel still renders available items.

4. [ ] Documentation update - `design.md` (tool details distance labels):
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document that tool details show raw distance values and that lower is better.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update tool UI notes to call out distance display.
   - Purpose: Keep UI documentation accurate.

5. [ ] Run `npm run lint --workspace client` and `npm run format:check --workspace client`; fix issues before continuing.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier: https://prettier.io/docs/options

#### Testing

1. [ ] `npm run test --workspace client`

#### Implementation notes

- Notes added during implementation.

---

### 7. Final verification + documentation + PR summary

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Validate the full story against acceptance criteria, perform clean builds/tests, update documentation, and produce the pull request summary for the story.

#### Documentation Locations

- Docker Compose guide (clean builds + compose up/down): https://docs.docker.com/guides/docker-compose/
- Playwright Test docs (Node/TS setup + running tests): https://playwright.dev/docs/intro
- Husky docs (git hook management + install): https://typicode.github.io/husky/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Build the server
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Recap: confirm server build works outside Docker before final verification.
2. [ ] Build the client
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Recap: confirm client build works outside Docker before final verification.
3. [ ] Perform a clean docker build
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Recap: clean build must succeed to validate images.
4. [ ] Ensure `README.md` is updated with any required description changes and with any new commands that have been added as part of this story
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document user-visible retrieval changes and update the MCP `codebase_question` response example to answer-only segments.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Update user-facing notes and any new commands introduced by this story.
   - Purpose: Keep onboarding docs accurate.
5. [ ] Ensure `design.md` is updated with any required description changes including Mermaid diagrams that have been added as part of this story
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: ensure retrieval cutoff/caps and answer-only MCP notes are documented.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update architecture notes and diagrams for retrieval + MCP response changes.
   - Purpose: Keep design documentation accurate.
6. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree only if file paths change.
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this story.
   - Purpose: Keep the repository map current.
7. [ ] Create a summary of all changes and draft the PR comment for this story
   - Requirements:
     - Summarize server and client changes separately.
     - Include test commands executed and any known follow-ups.

#### Testing

1. [ ] `npm run build --workspace server`
2. [ ] `npm run build --workspace client`
3. [ ] `npm run compose:build`
4. [ ] `npm run compose:up`
5. [ ] `npm run test --workspace client`
6. [ ] `npm run test --workspace server`
7. [ ] `npm run e2e`
8. [ ] Manual Playwright-MCP check: verify tool details show distance labels/values, citations are deduped to top-2 per file, and no MCP answer-only regressions.
9. [ ] `npm run compose:down`

#### Implementation notes

- Notes added during implementation.
