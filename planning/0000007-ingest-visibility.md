# Story 0000007 – Ingest visibility & AI output clarity

## Description
Improve observability during ingest and chat so users see which files are being processed and how tool calls drive answers. While ingest runs, expose per-file progress instead of only chunk counts so long runs feel transparent and debuggable. During chat, surface tool invocation moments and show which files/vector results informed the reply. Finally, format assistant responses as markdown (with mermaid support) to make structured answers and diagrams easy to consume.

Also support OpenAI/GPT-OSS "Harmony" channel-tagged output (e.g., `<|channel|>analysis<|message|>...<|end|><|start|>assistant<|channel|>final<|message|>` — see https://cookbook.openai.com/articles/openai-harmony), treating `analysis` as hidden/collapsible reasoning (like `<think>`) and `final` as the visible reply, even while streaming. We will implement this parsing ourselves (no external Harmony renderer dependency) alongside our existing think/tool handling.

## Acceptance Criteria
- Ingest UI and API expose the current file path being processed (in addition to chunk counts) and update it live during a run.
- Chat transcript shows when LM Studio tools are invoked, including the tool name and timing, without disrupting the conversation flow, via an inline spinner inside the active assistant bubble that stops when the call finishes.
- Completed tool calls collapse into an inline expandable section that reveals the tool name, result payload, and errors (if any); for VectorSearch this includes the list of chunks and the list of files/paths returned.
- VectorSearch results displayed in chat include the repo and relative file paths used for grounding; users can see which files informed the answer.
- Assistant messages render as markdown, preserving code blocks and allowing mermaid diagrams to display correctly in the client.
- `<think>` content stays collapsed as soon as the opening tag is seen, even before the closing tag arrives; while streaming, show a thinking icon + spinner on the collapsible header, and allow users to open it to watch the think text stream.
- Harmony/OpenAI channel-tagged outputs (e.g., `<|channel|>analysis<|message|>...<|end|><|start|>assistant<|channel|>final<|message|>`) are parsed and rendered with the analysis content collapsed like think blocks and the final content shown as the visible reply.
- Behaviour is documented in README/design with any new env flags or UI states; existing tests are expanded or added to cover the new visibility and markdown flows.

## Out Of Scope
- Changing ingest chunking/tokenization behaviour or performance tuning beyond exposing progress.
- Adding new ingestion data sources or authentication flows.
- Full redesign of the chat UI layout; changes are limited to visibility/formatting additions.
- Server-side RAG parameter tuning (topK/temperature) beyond existing defaults.

## Questions (all resolved)
- Should file-progress reporting include percentage/ETA or just the current file name/path? **Decision:** include percentage, current index/total, ETA, and current file path.
- How should tool-call visibility appear in the chat UI (inline status line, chips, or a collapsible log)? **Decision:** inline spinner inside the active assistant bubble; on completion it collapses into an expandable block with details.
- Do we need a toggle to disable tool-call visibility for minimal mode? **Decision:** no toggle; tool details stay in collapsible blocks users can leave closed.
- Are there security/privacy constraints on showing full host paths in chat, or should we truncate to repo/relPath only? **Decision:** no constraints; show full host paths (local dev only).
- For mermaid rendering, should we support dark/light themes or rely on MUI theme defaults? **Decision:** rely on MUI theme defaults (light/dark aware) with no extra toggle.

# Implementation Plan

## Instructions
(This section is the standard process to follow once tasks are created.)

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
(To be detailed later; task breakdown will follow this template when we task up.)

---
