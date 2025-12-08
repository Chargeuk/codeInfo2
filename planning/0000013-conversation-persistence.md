# Story 0000013 – Persistent Conversation History (MongoDB)

## Description

Add MongoDB (via the latest Mongoose) to persist chat conversations so sessions survive client reloads and normalize the flow across Codex and LM Studio providers. Each conversation gets a unique id (Codex threads reuse the Codex thread id) with individual turns stored separately and timestamped. The chat page should surface a left-hand history menu sorted newest-first; continuing a conversation only sends the conversation id plus the new message, never the full transcript.

## Acceptance Criteria

- MongoDB connection configured in the server using the latest Mongoose; connection settings documented and env-driven.
- Conversation model: unique conversation id (Codex uses thread id), provider enum, created/updated timestamps; turn model references conversation, stores role/content/timestamp.
- Server exposes APIs to create conversation, append turn, fetch paginated history, and list conversations ordered newest-first; Codex/LM Studio both resume using just the conversation id.
- Client chat page shows a left-hand conversation history (newest first) and loads turns lazily from the server; sending a message only sends conversation id + new text for both providers.
- Existing chat behaviour (streaming, stop, flags, citations) remains unchanged aside from persistence; e2e/tests updated to cover persisted flows.

## Out Of Scope

- Multi-user auth/ACL; assume single-user storage for now.
- Vector store changes; MongoDB only for conversation metadata/turns.
- Full-text search across conversations (basic listing only).
- Migration tooling beyond initial schema setup.
- Per-turn payload size limits (no cap in this story).
- Optimistic locking/concurrency control between tabs.
- Retention/TTL limits for stored turns (indefinite retention in this story).

## Questions

- What MongoDB deployment target do we assume for dev/e2e (Docker service vs. external URI)? → **Use local MongoDB via Docker for dev and e2e.**
- Do we cap stored turns or add TTL/retention controls? → **No; store turns indefinitely for this story.**
- Should we support soft-delete/archiving for conversations? → **Yes; include soft-delete/archiving support.**
- What payload size limits should apply per turn? → **None for this story; keep it simple unless future need arises.**
- Do we need optimistic locking for concurrent writes from multiple tabs? → **No; out of scope for this story.**

# Implementation Plan

## Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks. This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit & push that change, and only then begin implementation.
4. For each task, execute every subtask sequentially: before starting a subtask, read the documentation sources listed in that task; after finishing the subtask, run the relevant linters/formatters (Python + TypeScript) and fix issues before continuing.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, Move on to the Testing section and work through the tests in order
7. Once a test is complete, mark its checkbox.
8. After tests pass, perform every documentation update listed for the task.
9. Once a document is updated, mark its checkbox.
10. When all subtasks, tests, documentation updates, and verification commands are complete, consider the task finished and follow points 11–13 below.
11. As soon as a task’s implementation is done, add detailed notes in the Implementation notes section covering the code changes, decisions made, and any issues encountered. Push immediately after writing the notes.
12. Record the relevant git commit hash(es) in the Git Commits section. Once they are pushed, set the task status to `Done`, and push again so both the commit IDs and updated status are captured in this document.
13. After a task is fully documented (status, notes, commits), proceed to the next task and repeat the same process.

# Tasks

Tasks will be added later.
