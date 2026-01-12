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

### 1. Server: MCP answer-only responses for codebase_question

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Return answer-only segments for MCP `codebase_question` responses while preserving `conversationId` and `modelId`. This keeps client parsing simple and ensures response payloads exclude reasoning and vector-summary segments without changing error handling.

#### Documentation Locations

- JSON-RPC 2.0 specification (response shape + result object): https://www.jsonrpc.org/specification
- JavaScript JSON serialization (`JSON.stringify` reference): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON
- Node.js `AbortController` + error handling patterns (reference for existing patterns, no changes): https://nodejs.org/api/globals.html#class-abortcontroller
- Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Markdown syntax (design notes updates): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review current MCP response assembly for codebase_question:
   - Documentation to read (repeat):
     - JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
   - Recap (acceptance criteria): return only the final answer segment while keeping `conversationId` and `modelId` unchanged.
   - Files to read:
     - `server/src/chat/responders/McpResponder.ts` (segment source for awareness)
     - `server/src/mcp2/tools/codebaseQuestion.ts`
     - `server/src/mcp2/server.ts`
     - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
     - `server/src/test/integration/mcp-codex-wrapper.test.ts`
     - `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`
   - Goal:
     - Identify where `segments` arrays are built and how answer content is extracted.

2. [ ] Update `codebase_question` tool response to return only the answer segment:
   - Documentation to read (repeat):
     - JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
     - JavaScript JSON serialization (`JSON.stringify`): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON
   - Files to edit:
     - `server/src/mcp2/tools/codebaseQuestion.ts`
   - Requirements:
     - Keep `conversationId` and `modelId` in the JSON response payload.
     - Replace multi-segment payloads with a single `answer` segment (final answer text only).
     - Filter segments in the `runCodebaseQuestion` payload without changing `McpResponder`.
     - Preserve error handling for archived conversations and tool failures.
   - Example (intentional pseudo-code):
     ```ts
     const payload = responder.toResult(modelId, conversationId);
     const answerOnly = payload.segments.filter((s) => s.type === 'answer');
     payload.segments = answerOnly.length > 0 ? answerOnly : [{ type: 'answer', text: '' }];
     ```

3. [ ] Update MCP tool definitions to reflect answer-only responses:
   - Documentation to read (repeat):
     - JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
   - Files to edit:
     - `server/src/mcp2/tools/codebaseQuestion.ts`
   - Requirements:
     - Update description strings to remove “thinking/vector_summary” language.
     - Keep input schemas unchanged.
   - Example (description update snippet):
     - Before: “returns ordered thinking, vector summaries, and a final answer …”
     - After: “returns a final answer segment plus conversationId and modelId …”

4. [ ] Update unit test for answer-only segments (codebase_question happy path):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (MCP tool)
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Description: Update assertions so `segments` contains only `['answer']` while keeping `conversationId` and `modelId` expectations.
   - Purpose: Validate the happy-path MCP tool response shape after answer-only filtering.

5. [ ] Update integration test for answer-only segments (Codex wrapper):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Integration (Codex MCP wrapper)
   - Location: `server/src/test/integration/mcp-codex-wrapper.test.ts`
   - Description: Assert the MCP wrapper payload includes only the `answer` segment.
   - Purpose: Ensure Codex wrapper integrations return the answer-only payload.

6. [ ] Update integration test for answer-only segments (LM Studio wrapper):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Integration (LM Studio MCP wrapper)
   - Location: `server/src/test/integration/mcp-lmstudio-wrapper.test.ts`
   - Description: Assert the MCP wrapper payload includes only the `answer` segment.
   - Purpose: Ensure LM Studio wrapper integrations return the answer-only payload.

7. [ ] Add corner-case unit test for missing answer segments:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (MCP tool)
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Description: Simulate no answer segment emitted and assert the response returns a single empty `answer` segment.
   - Purpose: Guarantee the answer-only filter always returns an `answer` segment.

8. [ ] Add error-path test for JSON-RPC error stability:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Integration (MCP JSON-RPC error path)
   - Location: `server/src/test/integration/mcp-codex-wrapper.test.ts`
   - Description: Trigger an invalid params or tool error and assert the JSON-RPC error shape is unchanged.
   - Purpose: Ensure answer-only filtering does not alter error responses.

9. [ ] Documentation update - `design.md` (MCP answer-only contract):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update MCP response shape notes to reflect answer-only segments for `codebase_question` and agents.
   - Purpose: Keep MCP contract documentation accurate.

10. [ ] Documentation update - `design.md` (MCP response flow diagram):
    - Documentation to read (repeat):
      - Mermaid: Context7 `/mermaid-js/mermaid`
      - Markdown syntax: https://www.markdownguide.org/basic-syntax/
    - Document: `design.md`
    - Location: `design.md`
    - Description: Update or add a Mermaid sequence diagram if MCP response flows are documented.
    - Purpose: Ensure architecture flow diagrams match the answer-only response format.

11. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read (repeat):
      - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
      - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Run server tests (Cucumber):
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
   - Purpose: Validate server BDD tests alongside MCP answer-only changes.

4. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate client test coverage while MCP answer-only behavior is active.

5. [ ] Run end-to-end tests:
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Command: `npm run e2e`
   - Timeout: allow up to 7 minutes (e.g., `timeout 7m npm run e2e` or `timeout_ms=420000`).
   - Purpose: Validate end-to-end chat/tool flows with MCP answer-only responses.

6. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with MCP response changes.

7. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with MCP answer-only responses.

8. [ ] Manual Playwright-MCP check (visual verification):
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Location: http://host.docker.internal:5001
   - Description: Navigate to Chat and Agents flows, confirm MCP responses only surface the final answer (no reasoning/vector summary), and verify there are no logged errors in the debug console.
   - Purpose: Manual verification of MCP answer-only behavior and UI stability.

9. [ ] Shut down Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:down`
   - Purpose: Cleanly stop the stack after verification.

10. [ ] Run server unit tests for MCP answer-only changes:
    - Documentation to read (repeat):
      - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
    - Command: `npm run test:unit --workspace server`
    - Purpose: Ensure MCP answer-only response changes do not break existing server unit tests.

#### Implementation notes

- Notes added during implementation.

---

### 2. Server: MCP agents answer-only responses

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Return answer-only segments for MCP agent `run_agent_instruction` responses while preserving `conversationId` and `modelId`. This keeps agent MCP payloads aligned with the new answer-only contract without altering error codes or run-lock behavior.

#### Documentation Locations

- JSON-RPC 2.0 specification (response shape + result object): https://www.jsonrpc.org/specification
- JavaScript JSON serialization (`JSON.stringify` reference): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON
- Node.js `AbortController` + error handling patterns (reference for existing patterns, no changes): https://nodejs.org/api/globals.html#class-abortcontroller
- Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review current MCP agent response assembly:
   - Documentation to read (repeat):
     - JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
   - Recap (acceptance criteria): return only the final answer segment while keeping `conversationId` and `modelId` unchanged.
   - Files to read:
     - `server/src/mcpAgents/tools.ts`
     - `server/src/agents/service.ts` (segment source for awareness)
     - `server/src/test/unit/mcp-agents-tools.test.ts`
     - `server/src/test/unit/mcp-agents-router-run.test.ts`
   - Goal:
     - Confirm where agent segments are assembled and passed through to MCP responses.

2. [ ] Update agent MCP tooling to mirror answer-only responses:
   - Documentation to read (repeat):
     - JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
     - JavaScript JSON serialization (`JSON.stringify`): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Requirements:
     - Ensure `run_agent_instruction` responses return only the final answer segment.
     - Filter segments in the MCP tool response without changing `agents/service` or `McpResponder`.
     - Preserve `conversationId` + `modelId` fields and existing status/error codes.
   - Example (intentional pseudo-code):
     ```ts
     const result = await runAgentInstruction(...);
     const answerOnly = result.segments.filter((s) => s.type === 'answer');
     return { ...result, segments: answerOnly.length ? answerOnly : [{ type: 'answer', text: '' }] };
     ```

3. [ ] Update MCP tool definitions to reflect answer-only responses:
   - Documentation to read (repeat):
     - JSON-RPC 2.0 specification: https://www.jsonrpc.org/specification
   - Files to edit:
     - `server/src/mcpAgents/tools.ts`
   - Requirements:
     - Update description strings to remove “thinking/vector_summary” language.
     - Keep input schemas unchanged.
   - Example (description update snippet):
     - Before: “ordered thinking/vector summaries/answer segments …”
     - After: “final answer segment plus conversationId and modelId …”

4. [ ] Update unit test for answer-only segments (agent tool response):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (agent MCP tool)
   - Location: `server/src/test/unit/mcp-agents-tools.test.ts`
   - Description: Assert `segments` contains only `['answer']` in the tool result.
   - Purpose: Verify answer-only filtering for agent tool responses.

5. [ ] Update unit test for answer-only segments (router run response):
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (router JSON-RPC response)
   - Location: `server/src/test/unit/mcp-agents-router-run.test.ts`
   - Description: Assert `tools/call` run_agent_instruction returns only the `answer` segment.
   - Purpose: Confirm router wiring preserves the answer-only response shape.

6. [ ] Add corner-case unit test for missing answer segments:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (agent MCP tool)
   - Location: `server/src/test/unit/mcp-agents-tools.test.ts`
   - Description: Simulate a response without an answer segment and assert a single empty `answer` segment is returned.
   - Purpose: Ensure answer-only filtering always yields an `answer` segment for agents.

7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Run server tests (Cucumber):
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
   - Purpose: Validate server BDD tests alongside agent MCP answer-only changes.

4. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate client test coverage while agent MCP answer-only behavior is active.

5. [ ] Run end-to-end tests:
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Command: `npm run e2e`
   - Timeout: allow up to 7 minutes (e.g., `timeout 7m npm run e2e` or `timeout_ms=420000`).
   - Purpose: Validate end-to-end flows with agent MCP answer-only responses.

6. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with MCP response changes.

7. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with agent MCP answer-only responses.

8. [ ] Manual Playwright-MCP check (visual verification):
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Location: http://host.docker.internal:5001
   - Description: Navigate to Agents UI, run an agent instruction, confirm only the final answer is shown (no reasoning/vector summary), and verify there are no logged errors in the debug console.
   - Purpose: Manual verification of agent MCP answer-only behavior and UI stability.

9. [ ] Shut down Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:down`
   - Purpose: Cleanly stop the stack after verification.

10. [ ] Run server unit tests for MCP agent answer-only changes:
    - Documentation to read (repeat):
      - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
    - Command: `npm run test:unit --workspace server`
    - Purpose: Ensure agent MCP response changes do not break server unit tests.

#### Implementation notes

- Notes added during implementation.

---

### 3. Server: distance semantics for vector aggregations (min distance)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Switch vector “best match” aggregation to use minimum distance values (lower is better) across tool aggregation and MCP vector summaries. This keeps reported matches consistent with Chroma’s distance semantics and prevents future cutoff logic from using inverted values.

#### Documentation Locations

- ChromaDB query API reference (query results + distances): https://docs.trychroma.com/reference/Collection
- JavaScript `Math.min` behavior (null/undefined handling): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/min
- Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Markdown syntax (design notes updates): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review current vector aggregation logic and tests:
   - Documentation to read (repeat):
     - ChromaDB docs: https://docs.trychroma.com/reference/Collection
   - Recap (acceptance criteria): “best match” must be the minimum distance, and ordering stays as returned by Chroma.
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
     - `server/src/chat/responders/McpResponder.ts`
     - `server/src/test/unit/tools-vector-search.test.ts`
     - `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Goal:
     - Locate `Math.max` usage and determine how `highestMatch` is reported.

2. [ ] Update vector file aggregation to use minimum distance:
   - Documentation to read (repeat):
     - JavaScript `Math.min`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/min
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Replace `Math.max` with `Math.min` when computing `highestMatch` for each file.
     - Keep `highestMatch` `null` if no numeric distances exist.
     - Preserve result ordering and existing score-source logging.
   - Example (target change):
     - `existing.highestMatch = prev === null ? item.score : Math.min(prev, item.score);`

3. [ ] Update MCP vector summary aggregation to use minimum distance:
   - Documentation to read (repeat):
     - JavaScript `Math.min`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/min
   - Files to edit:
     - `server/src/chat/responders/McpResponder.ts`
   - Requirements:
     - Ensure summary `match` uses the lowest distance across entries.
     - Preserve current summary ordering and shape.
   - Example (target change):
     - `base.match = base.match === null ? item.score : Math.min(base.match, item.score);`

4. [ ] Update unit test for tool aggregation min-distance:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector tool aggregation)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert `highestMatch` uses the smallest distance and remains `null` when no numeric distances exist.
   - Purpose: Verify tool aggregation reports correct min-distance semantics.

5. [ ] Update MCP tool test for vector summary min-distance:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (MCP tool summary)
   - Location: `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`
   - Description: Assert the vector summary `match` reflects the lowest distance.
   - Purpose: Ensure MCP summaries align with min-distance semantics.

6. [ ] Documentation update - `design.md` (min-distance wording):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update wording around vector “best match” aggregation to reflect min-distance semantics.
   - Purpose: Keep retrieval semantics aligned with Chroma distance.

7. [ ] Documentation update - `design.md` (match scoring diagram updates):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update any Mermaid retrieval flow diagrams that mention match scoring.
   - Purpose: Ensure architecture diagrams reflect min-distance aggregation.

8. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Run server tests (Cucumber):
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
   - Purpose: Validate server BDD tests alongside min-distance aggregation changes.

4. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate client test coverage while min-distance semantics are active.

5. [ ] Run end-to-end tests:
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Command: `npm run e2e`
   - Timeout: allow up to 7 minutes (e.g., `timeout 7m npm run e2e` or `timeout_ms=420000`).
   - Purpose: Validate end-to-end tool flows with corrected distance semantics.

6. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with aggregation changes.

7. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with corrected min-distance aggregation.

8. [ ] Manual Playwright-MCP check (visual verification):
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Location: http://host.docker.internal:5001
   - Description: Use tool detail panels to confirm best-match distances align with “lower is better” expectations and verify there are no logged errors in the debug console.
   - Purpose: Manual validation of distance semantics and UI stability.

9. [ ] Shut down Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:down`
   - Purpose: Cleanly stop the stack after verification.

10. [ ] Run server unit tests for min-distance semantics:
    - Documentation to read (repeat):
      - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
    - Command: `npm run test:unit --workspace server`
    - Purpose: Validate updated aggregation behavior with the server unit test suite.

#### Implementation notes

- Notes added during implementation.

---

### 4. Server: retrieval cutoff + fallback selection

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Introduce distance-based cutoff logic for vector search results with an env-configured threshold and fallback selection. This ensures only relevant chunks are sent to Codex while still including the best 1–2 chunks when no items pass the cutoff.

#### Documentation Locations

- Node.js `process.env` (environment variable defaults): https://nodejs.org/api/process.html#processenv
- ChromaDB query API reference (query results + distances): https://docs.trychroma.com/reference/Collection
- JavaScript array sort and stable ordering references: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
- Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Markdown syntax (design notes updates): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review vector search tool flow and existing env usage:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Recap (acceptance criteria): default cutoff `<= 1.4`, cutoff bypass flag, fallback to best 1–2 chunks when no items pass.
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
     - `server/src/logger.ts` (existing numeric env parser)
     - `server/src/ingest/config.ts` (numeric clamp patterns)
     - `server/src/config.ts`
     - `server/src/test/unit/tools-vector-search.test.ts`
   - Goal:
     - Identify where scores/distances are read and how tool output is assembled.

2. [ ] Add env-driven cutoff configuration:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Reuse the existing `parseNumber` helper in `server/src/logger.ts` (or extract it to a shared utility) for numeric env defaults; avoid new ad-hoc parsing.
     - Read `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF`, `CODEINFO_RETRIEVAL_CUTOFF_DISABLED`, and `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS` with defaults.
     - Parse numeric values safely; treat invalid values as default.
     - Keep existing score-source logging unchanged.
   - Example (expected defaults):
     - cutoff `1.4`, cutoffDisabled `false`, fallback `2`.

3. [ ] Apply cutoff and fallback selection in vectorSearch:
   - Documentation to read (repeat):
     - ChromaDB query result semantics: https://docs.trychroma.com/reference/Collection
     - JavaScript array sort: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Filter results using `distance <= cutoff` when cutoff is enabled.
     - When cutoff is disabled, keep all results eligible for downstream caps.
     - When no entries pass, include the best `fallback` chunks (lowest distance, original-order tie-break).
     - Preserve the original ordering of retained results.
     - Treat missing/non-numeric distances as lowest priority for cutoff + fallback.
     - Apply cutoff/fallback **before** payload caps so the caps only apply to eligible results.
     - Ensure `files` summaries are rebuilt from the filtered results (not the pre-cutoff list).
   - Example (selection outline):
     ```ts
     const eligible = cutoffDisabled ? results : results.filter(r => typeof r.score === 'number' && r.score <= cutoff);
     const picked = eligible.length ? eligible : pickLowest(results, fallback);
     ```

4. [ ] Add unit test for cutoff enabled filtering:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector search filtering)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert results are filtered to distances `<= cutoff` when cutoff is enabled.
   - Purpose: Validate the default happy-path cutoff behavior.

5. [ ] Add unit test for cutoff disabled:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector search filtering)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert all results remain eligible when `CODEINFO_RETRIEVAL_CUTOFF_DISABLED=true`.
   - Purpose: Verify the cutoff bypass flag works.

6. [ ] Add unit test for fallback selection when none pass:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector search fallback)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert the best N (lowest distance) results are kept when cutoff filters all items.
   - Purpose: Ensure fallback chunks are always provided.

7. [ ] Add unit test for empty result sets:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector search edge case)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert empty inputs return an empty payload without errors.
   - Purpose: Cover the no-results corner case.

8. [ ] Add unit test for all-missing distance values:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector search edge case)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert missing/non-numeric distances are treated as lowest priority and only included via fallback.
   - Purpose: Validate missing score handling.

9. [ ] Add unit test for tie-break ordering:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector search ordering)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert equal-distance items preserve original order after filtering/fallback.
   - Purpose: Confirm stable ordering requirements.

10. [ ] Add unit test for file summaries after filtering:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector file summaries)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert `files` summaries are rebuilt from filtered results (e.g., excluded file paths are absent and chunk counts match filtered results).
   - Purpose: Ensure summary payloads reflect the cutoff-filtered result set.

11. [ ] Add unit test for invalid env values:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (env parsing edge case)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Provide non-numeric or negative env values and assert defaults are used.
   - Purpose: Ensure env parsing guards apply.

12. [ ] Update server `.env` with retrieval cutoff defaults:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Recap: document cutoff, bypass flag, and fallback defaults for local runs.
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Add commented defaults for `CODEINFO_RETRIEVAL_DISTANCE_CUTOFF`, `CODEINFO_RETRIEVAL_CUTOFF_DISABLED`, and `CODEINFO_RETRIEVAL_FALLBACK_CHUNKS`.
     - Keep existing env ordering and comment style.

13. [ ] Documentation update - `design.md` (cutoff + fallback text):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Add retrieval cutoff, fallback defaults, and bypass flag text.
   - Purpose: Keep retrieval strategy documentation accurate.

14. [ ] Documentation update - `design.md` (cutoff flow diagram):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update or add a Mermaid retrieval flow diagram that includes cutoff + fallback steps.
   - Purpose: Ensure architecture diagrams reflect cutoff logic.

15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Run server tests (Cucumber):
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
   - Purpose: Validate server BDD tests alongside cutoff/fallback changes.

4. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate client test coverage while cutoff logic is active.

5. [ ] Run end-to-end tests:
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Command: `npm run e2e`
   - Timeout: allow up to 7 minutes (e.g., `timeout 7m npm run e2e` or `timeout_ms=420000`).
   - Purpose: Validate end-to-end retrieval flows with cutoff and fallback behavior.

6. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with cutoff logic changes.

7. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with retrieval cutoff behavior.

8. [ ] Manual Playwright-MCP check (visual verification):
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Location: http://host.docker.internal:5001
   - Description: Trigger a vector search, confirm low-relevance chunks are trimmed with fallback still present when needed, and verify there are no logged errors in the debug console.
   - Purpose: Manual verification of cutoff/fallback behavior and UI stability.

9. [ ] Shut down Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:down`
   - Purpose: Cleanly stop the stack after verification.

10. [ ] Run server unit tests for retrieval cutoff behavior:
    - Documentation to read (repeat):
      - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
    - Command: `npm run test:unit --workspace server`
    - Purpose: Validate cutoff/fallback logic against the server unit test suite.

#### Implementation notes

- Notes added during implementation.

---

### 5. Server: tool payload size caps (total + per-chunk)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Enforce tool payload caps for Codex retrieval by limiting per-chunk text length and total tool output size. This ensures the tool payload never exceeds configured character limits while keeping result order intact.

#### Documentation Locations

- Node.js `process.env` (environment variable defaults): https://nodejs.org/api/process.html#processenv
- JavaScript `String.prototype.slice` (truncation behavior): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice
- Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Markdown syntax (design notes updates): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review vector search payload construction and existing test coverage:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Recap (acceptance criteria): total tool output capped at `CODEINFO_TOOL_MAX_CHARS`, per-chunk capped at `CODEINFO_TOOL_CHUNK_MAX_CHARS`.
   - Files to read:
     - `server/src/lmstudio/toolService.ts`
     - `server/src/logger.ts` (existing numeric env parser)
     - `server/src/ingest/config.ts` (numeric clamp patterns)
     - `server/src/test/unit/tools-vector-search.test.ts`
   - Goal:
     - Locate where chunks are assembled and where size counting can be applied.

2. [ ] Add env-driven cap configuration:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Reuse the existing `parseNumber` helper in `server/src/logger.ts` (or extract it to a shared utility) for numeric env defaults; avoid new ad-hoc parsing.
     - Read `CODEINFO_TOOL_MAX_CHARS` and `CODEINFO_TOOL_CHUNK_MAX_CHARS` with defaults.
     - Parse numeric values safely; treat invalid values as defaults.
   - Example (expected defaults):
     - total cap `40000`, per-chunk cap `5000`.

3. [ ] Apply per-chunk truncation and total payload cap:
   - Documentation to read (repeat):
     - JavaScript `String.prototype.slice`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice
   - Files to edit:
     - `server/src/lmstudio/toolService.ts`
   - Requirements:
     - Truncate each chunk text to the per-chunk cap before counting total size.
     - Drop additional chunks once total size would exceed the max.
     - Preserve original ordering of the retained chunks.
     - Ensure zero chunks are returned if the total cap is too small to include any truncated chunk.
     - Recompute `lineCount` for truncated chunks so the totals match the capped text.
     - Build `files` summaries from the capped results to keep tool details consistent.
   - Example (cap loop outline):
     ```ts
     let used = 0;
     const capped = [];
     for (const item of results) {
       const chunk = item.chunk.slice(0, chunkCap);
       if (used + chunk.length > totalCap) break;
       used += chunk.length;
       capped.push({ ...item, chunk });
     }
     ```

4. [ ] Add unit test for per-chunk truncation:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (payload truncation)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert each chunk is truncated to `CODEINFO_TOOL_CHUNK_MAX_CHARS`.
   - Purpose: Verify per-chunk truncation logic.

5. [ ] Add unit test for total cap enforcement:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (payload cap)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert additional chunks are dropped once the total cap is reached.
   - Purpose: Ensure total payload limits are enforced.

6. [ ] Add unit test for caps too small to include any chunk:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (payload edge case)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Set the total cap below one truncated chunk and assert results are empty.
   - Purpose: Cover the zero-results edge case for caps.

7. [ ] Add unit test for line counts after truncation:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (payload truncation)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert `lineCount` reflects the truncated chunk text rather than the original chunk.
   - Purpose: Ensure line totals match capped payloads.

8. [ ] Add unit test for file summaries after caps:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (vector file summaries)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Assert `files` summaries use the capped results (chunk counts/line counts align with truncated output).
   - Purpose: Keep summary payloads consistent with capped results.

9. [ ] Add unit test for invalid env values:
   - Documentation to read (repeat):
     - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
   - Test type: Unit (env parsing edge case)
   - Location: `server/src/test/unit/tools-vector-search.test.ts`
   - Description: Provide non-numeric or negative cap values and assert defaults are used.
   - Purpose: Ensure env parsing guards apply.

10. [ ] Update server `.env` with tool cap defaults:
   - Documentation to read (repeat):
     - Node.js `process.env`: https://nodejs.org/api/process.html#processenv
   - Recap: document total and per-chunk cap defaults for local runs.
   - Files to edit:
     - `server/.env`
   - Requirements:
     - Add commented defaults for `CODEINFO_TOOL_MAX_CHARS` and `CODEINFO_TOOL_CHUNK_MAX_CHARS`.
     - Keep existing env ordering and comment style.

11. [ ] Documentation update - `design.md` (tool cap defaults text):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Document total/per-chunk cap defaults and truncation behavior in text.
   - Purpose: Keep tool payload documentation accurate.

12. [ ] Documentation update - `design.md` (payload cap diagram):
    - Documentation to read (repeat):
      - Mermaid: Context7 `/mermaid-js/mermaid`
      - Markdown syntax: https://www.markdownguide.org/basic-syntax/
    - Document: `design.md`
    - Location: `design.md`
    - Description: Update or add a Mermaid diagram covering payload capping/truncation steps.
    - Purpose: Ensure architecture diagrams reflect payload cap logic.

13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read (repeat):
      - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
      - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Run server tests (Cucumber):
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
   - Purpose: Validate server BDD tests alongside payload cap changes.

4. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate client test coverage while payload caps are active.

5. [ ] Run end-to-end tests:
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Command: `npm run e2e`
   - Timeout: allow up to 7 minutes (e.g., `timeout 7m npm run e2e` or `timeout_ms=420000`).
   - Purpose: Validate end-to-end retrieval flows with payload caps.

6. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with payload cap changes.

7. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with payload cap logic applied.

8. [ ] Manual Playwright-MCP check (visual verification):
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Location: http://host.docker.internal:5001
   - Description: Trigger a large vector search payload, confirm tool output truncates without UI failures, and verify there are no logged errors in the debug console.
   - Purpose: Manual verification of payload cap behavior and UI stability.

9. [ ] Shut down Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:down`
   - Purpose: Cleanly stop the stack after verification.

10. [ ] Run server unit tests for payload caps:
    - Documentation to read (repeat):
      - Node.js test runner (`node:test`) basics: https://nodejs.org/api/test.html
    - Command: `npm run test:unit --workspace server`
    - Purpose: Confirm truncation/cap logic passes the server unit test suite.

#### Implementation notes

- Notes added during implementation.

---

### 6. Client: citation dedupe rules (two-stage + top-2 per file)

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Deduplicate VectorSearch citations on the client by removing exact duplicates per file and limiting to the top 2 chunks per file by lowest distance. This keeps citation displays concise and consistent with the retrieval strategy.

#### Documentation Locations

- MDN `Map` (keyed grouping for file buckets): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
- MDN `Array.prototype.sort` (stable ordering and tie-breaks): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
- Jest expect API (assertions for tool payloads): Context7 `/jestjs/jest` (ExpectAPI.md)
- Testing Library React docs (component-level testing utilities): https://testing-library.com/docs/react-testing-library/intro/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Markdown syntax (design notes updates): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

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
   - Documentation to read (repeat):
     - MDN `Map`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
     - MDN `Array.prototype.sort`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
   - Files to edit:
     - `client/src/hooks/useChatStream.ts`
   - Requirements:
     - Stage 1: remove duplicates by chunk id or identical chunk text **within the same `repo + relPath` bucket**.
     - Stage 2: if more than 2 remain per file, keep the 2 with lowest distance (tie-break by original order).
     - Treat missing/non-numeric distances as lowest priority (only included when needed for fallback).
     - Apply before assigning `assistantCitationsRef.current` so Chat + Agents share the same data.
   - Example (bucketing outline):
     ```ts
     const key = `${repo}:${relPath}`;
     const byFile = new Map<string, ToolCitation[]>();
     // de-dupe by chunkId OR chunk text within key, then sort by score.
     ```

3. [ ] Add unit test for duplicate chunk ids:
   - Documentation to read (repeat):
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (hook payload processing)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Provide duplicate `chunkId` values within the same file and assert only one remains.
   - Purpose: Verify stage-1 dedupe by chunk id.

4. [ ] Add unit test for duplicate chunk text within the same file:
   - Documentation to read (repeat):
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (hook payload processing)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Provide identical chunk text within the same file and assert only one remains.
   - Purpose: Verify stage-1 dedupe by chunk text.

5. [ ] Add unit test for duplicate chunk text across different files:
   - Documentation to read (repeat):
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (hook payload processing)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Provide identical chunk text in different `repo + relPath` buckets and assert both files remain.
   - Purpose: Ensure dedupe does not remove cross-file citations.

6. [ ] Add unit test for top-2 per file with distance tie-breaks:
   - Documentation to read (repeat):
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (hook payload processing)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Provide 3+ citations in one file and assert the two lowest distances remain in original order when tied.
   - Purpose: Validate stage-2 per-file limiting and ordering rules.

7. [ ] Add unit test for malformed citations missing `repo` or `relPath`:
   - Documentation to read (repeat):
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (hook payload processing)
   - Location: `client/src/test/useChatStream.toolPayloads.test.tsx`
   - Description: Include citations with missing `repo`/`relPath` and assert they are ignored without crashing.
   - Purpose: Cover malformed input handling.

8. [ ] Documentation update - `design.md` (citation dedupe text):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Add citation dedupe rules (two-stage + top-2 per file) to retrieval strategy notes.
   - Purpose: Keep client citation behavior documented.

9. [ ] Documentation update - `design.md` (citation filtering diagram):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update or add a Mermaid diagram for citation filtering flow if a retrieval flow diagram exists.
   - Purpose: Ensure architecture diagrams reflect citation filtering.

10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read (repeat):
      - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
      - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Run server tests (Cucumber):
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
   - Purpose: Validate server BDD tests alongside citation dedupe changes.

4. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate citation dedupe logic with the client test suite.

5. [ ] Run end-to-end tests:
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Command: `npm run e2e`
   - Timeout: allow up to 7 minutes (e.g., `timeout 7m npm run e2e` or `timeout_ms=420000`).
   - Purpose: Validate end-to-end citation dedupe behavior.

6. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with citation dedupe updates.

7. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with citation dedupe changes.

8. [ ] Manual Playwright-MCP check (visual verification):
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Location: http://host.docker.internal:5001
   - Description: Inspect citations in Chat/Agents to confirm dedupe rules (top-2 per file) and verify there are no logged errors in the debug console.
   - Purpose: Manual verification of citation dedupe behavior and UI stability.

9. [ ] Shut down Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:down`
   - Purpose: Cleanly stop the stack after verification.

#### Implementation notes

- Notes added during implementation.

---

### 7. Client: tool details show distance labels + per-match distances

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Update Chat and Agents tool detail panels to explicitly label distance values and surface per-match distances when expanded. This clarifies that lower distances are better and makes raw score inspection easy for users.

#### Documentation Locations

- MUI Accordion (expandable tool details): https://llms.mui.com/material-ui/6.4.12/components/accordion.md
- MUI Typography (label text + value formatting): https://llms.mui.com/material-ui/6.4.12/components/typography.md
- MUI Stack (layout + spacing): https://llms.mui.com/material-ui/6.4.12/components/stack.md
- MUI Accordion API (slotProps/slots, TransitionProps deprecations): https://llms.mui.com/material-ui/6.4.12/api/accordion.md
- MUI AccordionSummary API (slotProps/slots): https://llms.mui.com/material-ui/6.4.12/api/accordion-summary.md
- Testing Library React docs (component testing patterns): https://testing-library.com/docs/react-testing-library/intro/
- Jest expect API (assertions for UI output): Context7 `/jestjs/jest` (ExpectAPI.md)
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Markdown syntax (design notes updates): https://www.markdownguide.org/basic-syntax/
- ESLint CLI (lint command usage): https://eslint.org/docs/latest/use/command-line-interface
- Prettier options (format check expectations): https://prettier.io/docs/options

#### Subtasks

1. [ ] Review current tool detail rendering for vector search entries:
   - Documentation to read (repeat):
     - MUI Accordion: https://llms.mui.com/material-ui/6.4.12/components/accordion.md
   - Recap (acceptance criteria): show explicit “Distance” labels and per-match distance values when expanded.
   - Files to read:
     - `package-lock.json` (confirm resolved `@mui/material` version)
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
     - `client/src/hooks/useChatStream.ts`
     - `client/src/test/chatPage.toolDetails.test.tsx`
     - `client/src/test/agentsPage.toolsUi.test.tsx`
   - Goal:
     - Identify the vector tool detail blocks and where tool payload `results` are available for per-match display.

2. [ ] Update tool detail UI labels for distance values:
   - Documentation to read (repeat):
     - MUI Accordion: https://llms.mui.com/material-ui/6.4.12/components/accordion.md
     - MUI Typography: https://llms.mui.com/material-ui/6.4.12/components/typography.md
     - MUI Stack: https://llms.mui.com/material-ui/6.4.12/components/stack.md
   - Files to edit:
     - `client/src/pages/ChatPage.tsx`
     - `client/src/pages/AgentsPage.tsx`
   - Requirements:
    - Replace ambiguous “Match” labels with “Distance” or “Lowest distance.”
    - Display per-match distance values alongside each chunk in expanded tool details.
    - Render per-match rows from tool payload `results` (not just file summaries), including the distance value and chunk preview.
    - Avoid introducing deprecated Accordion `TransitionProps`/`TransitionComponent`; use slots/slotProps if adjustments are needed per MUI 6.5.x API.
    - Skip or gracefully handle entries missing `repo` or `relPath` without breaking the tool panel.
    - Render a placeholder (e.g., “—”) when `score` is missing and avoid crashing if `chunk` is empty/missing.
    - Keep formatting consistent with existing tool detail accordions.
   - Example (UI row outline):
     - `Distance: 0.532 · repo/path.ts` + preview text from `result.chunk`.

3. [ ] Update ChatPage tool details test for distance labels:
   - Documentation to read (repeat):
     - Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (UI component)
   - Location: `client/src/test/chatPage.toolDetails.test.tsx`
   - Description: Assert the tool details display a “Distance” label and per-match distance values when expanded.
   - Purpose: Confirm ChatPage tool details surface distance values.

4. [ ] Update ChatPage tool details test for per-match rows:
   - Documentation to read (repeat):
     - Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (UI component)
   - Location: `client/src/test/chatPage.toolDetails.test.tsx`
   - Description: Assert per-match rows are rendered from tool payload `results` (distance + chunk preview).
   - Purpose: Ensure detailed results render in ChatPage tool panels.

5. [ ] Update AgentsPage tool details test for distance labels:
   - Documentation to read (repeat):
     - Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (UI component)
   - Location: `client/src/test/agentsPage.toolsUi.test.tsx`
   - Description: Assert the tool details display a “Distance” label and per-match distance values when expanded.
   - Purpose: Confirm AgentsPage tool details surface distance values.

6. [ ] Update AgentsPage tool details test for per-match rows:
   - Documentation to read (repeat):
     - Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (UI component)
   - Location: `client/src/test/agentsPage.toolsUi.test.tsx`
   - Description: Assert per-match rows render from tool payload `results` (distance + chunk preview).
   - Purpose: Ensure detailed results render in AgentsPage tool panels.

7. [ ] Update ChatPage tool details test for missing distance/preview:
   - Documentation to read (repeat):
     - Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (UI component)
   - Location: `client/src/test/chatPage.toolDetails.test.tsx`
   - Description: Provide a result with missing `score` or `chunk` and assert the UI renders a placeholder without crashing.
   - Purpose: Ensure missing distance/preview values are handled safely.

8. [ ] Update AgentsPage tool details test for missing distance/preview:
   - Documentation to read (repeat):
     - Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (UI component)
   - Location: `client/src/test/agentsPage.toolsUi.test.tsx`
   - Description: Provide a result with missing `score` or `chunk` and assert the UI renders a placeholder without crashing.
   - Purpose: Ensure missing distance/preview values are handled safely in Agents UI.

9. [ ] Update AgentsPage tool details test for missing `repo`/`relPath`:
   - Documentation to read (repeat):
     - Testing Library React docs: https://testing-library.com/docs/react-testing-library/intro/
     - Jest expect API: Context7 `/jestjs/jest` (ExpectAPI.md)
   - Test type: Client unit (UI component)
   - Location: `client/src/test/agentsPage.toolsUi.test.tsx`
   - Description: Include entries missing `repo`/`relPath` and assert the panel still renders available matches.
   - Purpose: Ensure tool panels tolerate malformed payload entries.

10. [ ] Documentation update - `design.md` (tool details distance text):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Document that tool details show raw distance values and that lower is better.
   - Purpose: Keep UI documentation accurate.

11. [ ] Documentation update - `design.md` (tool details UI diagram):
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update or add a Mermaid UI flow diagram if tool-details interactions are documented.
   - Purpose: Ensure UI flow diagrams reflect distance display updates.

12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
    - Documentation to read (repeat):
      - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
      - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Run server tests (Cucumber):
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
   - Purpose: Validate server BDD tests alongside tool details UI changes.

4. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate updated tool detail rendering in the client test suite.

5. [ ] Run end-to-end tests:
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Command: `npm run e2e`
   - Timeout: allow up to 7 minutes (e.g., `timeout 7m npm run e2e` or `timeout_ms=420000`).
   - Purpose: Validate end-to-end tool detail rendering and distance labels.

6. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with tool details UI updates.

7. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with tool details UI changes.

8. [ ] Manual Playwright-MCP check (visual verification):
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Location: http://host.docker.internal:5001
   - Description: Inspect tool details in Chat/Agents for “Distance” labels and per-match values, and verify there are no logged errors in the debug console.
   - Purpose: Manual verification of tool details UI and regression coverage.

9. [ ] Shut down Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:down`
   - Purpose: Cleanly stop the stack after verification.

#### Implementation notes

- Notes added during implementation.

---

### 8. Final verification + documentation + PR summary

- Task Status: **__to_do__**
- Git Commits: **to_do**

#### Overview

Validate the full story against acceptance criteria, perform clean builds/tests, update documentation, and produce the pull request summary for the story.

#### Documentation Locations

- Docker Compose guide (clean builds + compose up/down): Context7 `/docker/docs`
- Playwright Test docs (Node/TS setup + running tests): https://playwright.dev/docs/intro
- Husky docs (git hook management + install): https://typicode.github.io/husky/
- Mermaid docs (diagram syntax for design.md): Context7 `/mermaid-js/mermaid`
- Jest docs (test runner + expect API): Context7 `/jestjs/jest`
- npm run-script reference (running workspace scripts): https://docs.npmjs.com/cli/v9/commands/npm-run-script
- Cucumber guides (BDD + JavaScript workflow): https://cucumber.io/docs/guides/
- Cucumber quick-start walkthrough (example reference): https://cucumber.io/docs/guides/10-minute-tutorial/
- Markdown syntax (README/design updates): https://www.markdownguide.org/basic-syntax/

#### Subtasks

1. [ ] Ensure `README.md` is updated with any required description changes and with any new commands that have been added as part of this story
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: document user-visible retrieval changes and update the MCP `codebase_question` response example to answer-only segments.
   - Document: `README.md`
   - Location: `README.md`
   - Description: Update user-facing notes and any new commands introduced by this story.
   - Purpose: Keep onboarding docs accurate.
2. [ ] Ensure `design.md` is updated with any required description changes including Mermaid diagrams that have been added as part of this story
   - Documentation to read (repeat):
     - Mermaid: Context7 `/mermaid-js/mermaid`
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: ensure retrieval cutoff/caps and answer-only MCP notes are documented.
   - Document: `design.md`
   - Location: `design.md`
   - Description: Update architecture notes and diagrams for retrieval + MCP response changes.
   - Purpose: Keep design documentation accurate.
3. [ ] Ensure `projectStructure.md` is updated with any updated, added or removed files & folders **after all file additions/removals in this story**
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Recap: update tree after any tracked file additions/removals (exclude `test-results/`, `dist/`, and other ignored build outputs).
   - Document: `projectStructure.md`
   - Location: `projectStructure.md`
   - Description: Update tree entries for any new/changed files, including every file added or removed in this story.
   - Purpose: Keep the repository map current.
4. [ ] Create a summary of all changes and draft the PR comment for this story
   - Documentation to read (repeat):
     - Markdown syntax: https://www.markdownguide.org/basic-syntax/
   - Requirements:
     - Summarize server and client changes separately.
     - Include test commands executed and any known follow-ups.

5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.
   - Documentation to read (repeat):
     - ESLint CLI: https://eslint.org/docs/latest/use/command-line-interface
     - Prettier options: https://prettier.io/docs/options

#### Testing

1. [ ] Build the server (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace server`
   - Purpose: Ensure server TypeScript build succeeds outside Docker.

2. [ ] Build the client (workspace build):
   - Documentation to read (repeat):
     - npm run-script reference: https://docs.npmjs.com/cli/v9/commands/npm-run-script
   - Command: `npm run build --workspace client`
   - Purpose: Ensure client production build succeeds outside Docker.

3. [ ] Run server tests (Cucumber):
   - Documentation to read (repeat):
     - Cucumber guides: https://cucumber.io/docs/guides/
   - Command: `npm run test --workspace server`
   - Purpose: Confirm server BDD tests still pass with retrieval changes.

4. [ ] Run client tests (Jest):
   - Documentation to read (repeat):
     - Jest docs: Context7 `/jestjs/jest`
   - Command: `npm run test --workspace client`
   - Purpose: Validate citation dedupe + tool details UI tests.

5. [ ] Run end-to-end tests:
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Command: `npm run e2e`
   - Timeout: allow up to 7 minutes (e.g., `timeout 7m npm run e2e` or `timeout_ms=420000`).
   - Purpose: Validate end-to-end tool/citation behavior in the UI.

6. [ ] Perform a clean Docker Compose build:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:build`
   - Purpose: Validate Docker images build cleanly with the updated code.

7. [ ] Start Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:up`
   - Purpose: Ensure the full stack starts with the new retrieval logic.

8. [ ] Manual Playwright-MCP check (visual verification):
   - Documentation to read (repeat):
     - Playwright Test docs: https://playwright.dev/docs/intro
   - Location: http://host.docker.internal:5001
   - Description: Verify tool details show distance labels/values, citations are deduped to top-2 per file, MCP responses are answer-only, and confirm there are no logged errors in the debug console.
   - Purpose: Capture screenshots and confirm UI expectations beyond automated tests.

9. [ ] Shut down Docker Compose stack:
   - Documentation to read (repeat):
     - Docker/Compose: Context7 `/docker/docs`
   - Command: `npm run compose:down`
   - Purpose: Cleanly stop the stack after verification.

#### Implementation notes

- Notes added during implementation.
