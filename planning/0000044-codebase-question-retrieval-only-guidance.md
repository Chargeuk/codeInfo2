# Story 0000044 – Codebase Question Retrieval-Only Guidance

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

The repository already exposes a chat-style MCP tool named `codebase_question` and several agent prompts tell planning and tasking agents to use it while researching the codebase. That is useful, but it is currently too easy for agents to treat that tool as a “solve the problem for me” interface instead of a repository-retrieval interface.

This causes two user-facing problems:

- the working model can outsource reasoning to the chat model and receive advice that is broader, weaker, or less grounded than direct investigation of the code;
- agent instructions can become inconsistent, with some prompts treating `codebase_question` as a deep search tool and other prompts implicitly asking it to judge risk, propose fixes, or assess missing coverage.

The intended role of `codebase_question` in this product is narrower and more useful than that. It should help an agent find repository facts, candidate files, summaries of existing implementations, and other retrieval-heavy information so the working model spends fewer tokens on raw codebase search. The model doing the task must still perform its own reasoning, compare evidence, inspect source files directly, and decide what to change.

This story therefore aligns the guidance in all relevant surfaces so they say the same thing:

- the MCP tool description must describe `codebase_question` as a retrieval-only helper;
- the repository instructions in `AGENTS.md` must describe the tool the same way;
- the planning/tasking/research command prompts under `codex_agents` must reinforce the same rule and must stop wording the tool as if it should directly solve problems.

This story is intentionally guidance-only. The user has decided that there should be no runtime prompt rejection, no semantic classifier, and no hard enforcement in server code beyond the wording of the existing tool description and prompt files. The output of this story is therefore consistency and clarity, not a new validation layer.

### Acceptance Criteria

- The `codebase_question` MCP tool description clearly says it is for repository retrieval, codebase facts, likely file locations, summaries of existing implementations, and other evidence-gathering use cases.
- The `codebase_question` MCP tool description clearly says the calling agent must do its own reasoning and investigation after using the tool.
- `AGENTS.md` documents that repository-question MCP usage is retrieval-first and must not be treated as a problem-solving or code-review replacement.
- The relevant prompt files and command JSON files under `codex_agents` are updated so they all describe the role of `codebase_question` consistently.
- Planning-oriented prompts stop wording `codebase_question` as if it should decide how to fix issues, assess high-risk areas, or judge coverage on behalf of the calling agent.
- Research-oriented prompts still allow broad repository search, but they frame `codebase_question` as a retrieval source rather than a reasoning authority.
- Tasking-oriented prompts explicitly require the agent to inspect code and use retrieved evidence to make its own decisions.
- No server-side prompt rejection, heuristic blocking, or runtime validation is introduced for this story.
- The public MCP method name remains `codebase_question`.
- Existing REST and MCP request and response shapes remain unchanged for this story.
- Documentation updates explain the intended benefit in user terms: the tool reduces search cost, but the working model remains responsible for reasoning.

### Out Of Scope

- Adding runtime prompt rejection or semantic checks for “bad” `codebase_question` requests.
- Renaming the `codebase_question` MCP method.
- Changing answer payload shapes, websocket messages, or transcript rendering.
- Reworking unrelated agent instructions that do not mention repository-search MCP usage.
- Changing model selection, provider routing, or token budgeting behavior.
- Adding new MCP repository-search tools beyond clarifying the role of the existing one.

### Questions

None. The story is intentionally guidance-only and the scope-defining decisions are already resolved.

## Implementation Ideas

- Update the `codebase_question` description in `server/src/mcp2/tools/codebaseQuestion.ts` so it explicitly says:
  - use it for repository facts, file locations, implementation summaries, and likely code areas;
  - do not rely on it to decide how to fix an issue or whether coverage/risk is acceptable;
  - the caller must inspect source files and reason from evidence.
- Update `AGENTS.md` to mirror the same rule in repository-specific instructions.
- Review the planning, research, tasking, coding, and LM Studio agent prompts under `codex_agents` and normalize any wording that currently implies the tool should solve the task.
- Review command JSON files that currently instruct agents to ask the MCP tool broad advisory questions and rewrite them so they ask for evidence and then direct the agent to continue with manual inspection.
- Keep the wording consistent across all surfaces so there is one authoritative mental model for the tool.
- Do not add runtime checks or error paths in this story. The user has explicitly chosen guidance over enforcement.
