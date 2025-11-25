# Story 0000006 – LMStudio Chroma Tools

## Description

Give the LM Studio-backed assistant the ability to answer questions using the existing Chroma vector store. Add agent tools that (a) list previously ingested repositories and (b) run vector searches over stored chunks, optionally scoped to a specific repository. The goal is to let the agent ground answers in ingested repo content without exposing raw database plumbing to end users. The experience should feel like “ask the assistant about the codebase” with results filtered to relevant docs and repositories already processed by the ingest pipeline.

## Acceptance Criteria

- LM Studio agent exposes two tools: **ListIngestedRepositories** (returns names/ids and basic metadata) and **VectorSearch** (inputs: query text, optional repository identifier; outputs: ordered matches with source metadata and snippets).
- Vector search respects an optional repository filter so results can be constrained to one ingested repo; defaults to all ingested data when no filter is provided.
- Tools leverage the existing Chroma ingest collections and metadata (runId/root name/path/model, hashes, timestamps) without duplicating data or bypassing model-lock rules; assume the single locked embedding model already enforced by ingest.
- Tool responses include enough provenance (repo name/identifier, relative path, snippet, maybe chunk hash or offset info) for the assistant to surface inline citations to the user.
- Error handling is clear: empty repository list, missing/unknown repository filter, and Chroma/LM Studio failures surface actionable messages to the agent (and onward to the user).
- Security/guardrails: queries cannot execute arbitrary DB operations; access limited to read-only list/search on the ingest collections.
- Performance: sensible defaults for vector search (top-k/threshold) that keep responses fast enough for interactive chat (target under a few seconds with current data sizes).

## Out Of Scope

- Re-ingest, delete, or modify embeddings (handled by existing ingest UI/APIs).
- Multi-tenant auth/ACLs or per-user data isolation.
- Cross-vector-store federation or non-Chroma backends.
- UI changes beyond what the agent surface requires (no new client pages; chat UI may only need minimal affordances if any).
- Full citation rendering/UX polish in the client (focus on tool plumbing first).
- Tuning or exposing LLM/vector parameters (topK/topP/temperature/score thresholds) beyond baked-in sensible defaults.
- Supporting multiple embedding models or per-model routing (ingest remains locked to a single model).

## Questions

- Should vector search return chunk text, a trimmed snippet, or only metadata plus a server-side excerpt window?
- Any size limits on the chunk/snippet payload returned to the agent to avoid flooding the model context?
- Should queries allow additional filters (file extension, path prefix) now, or defer until after initial usage feedback?

## Implementation Plan

### Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks. This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit & push that change, and only then begin implementation.
4. For each task, execute every subtask sequentially: before starting a subtask, read the documentation sources listed in that task; after finishing the subtask, run the relevant linters/formatters (Python + TypeScript) and fix issues before continuing.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, Move on to the Testing section and work through the tests in order.
7. Once a test is complete, mark its checkbox.
8. After tests pass, perform every documentation update listed for the task.
9. Once a document is updated, mark its checkbox.
10. When all subtasks, tests, documentation updates, and verification commands are complete, consider the task finished and follow points 11–13 below.
11. As soon as a task’s implementation is done, add detailed notes in the Implementation notes section covering the code changes, decisions made, and any issues encountered. Push immediately after writing the notes.
12. Record the relevant git commit hash(es) in the Git Commits section. Once they are pushed, set the task status to `Done`, and push again so both the commit IDs and updated status are captured in this document.
13. After a task is fully documented (status, notes, commits), proceed to the next task and repeat the same process.

## Tasks

_(To be populated after scope/questions are resolved.)_
