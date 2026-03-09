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

For this story, "relevant surfaces" is intentionally concrete. At minimum, the implementation must review and update the places that currently describe repository-question tooling in user-facing or agent-facing instructions:

- `server/src/mcp2/tools/codebaseQuestion.ts`;
- `AGENTS.md`;
- `codex_agents/planning_agent/system_prompt.txt`;
- `codex_agents/vllm_agent/system_prompt.txt`;
- `codex_agents/lmstudio_agent/system_prompt.txt`;
- `codex_agents/research_agent/system_prompt.txt`;
- `codex_agents/planning_agent/commands/improve_plan.json`;
- `codex_agents/lmstudio_agent/commands/improve_plan.json`;
- `codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json`;
- `codex_agents/vllm_agent/commands/improve_plan.json`;
- `codex_agents/vllm_agent/commands/kadshow_improve_plan.json`;
- `codex_agents/tasking_agent/commands/task_up.json`.

If additional prompt or command files are found during implementation that also describe `codebase_question` or `code_info` as a reasoning authority, those files are in scope too. Unrelated prompts that do not mention repository-question MCP usage are not part of this story.

This story is intentionally guidance-only. The user has decided that there should be no runtime prompt rejection, no semantic classifier, and no hard enforcement in server code beyond the wording of the existing tool description and prompt files. The output of this story is therefore consistency and clarity, not a new validation layer.

### Acceptance Criteria

- The `codebase_question` MCP tool description in `server/src/mcp2/tools/codebaseQuestion.ts` explicitly says the tool is for repository retrieval, codebase facts, likely file locations, summaries of existing implementations, and similar evidence-gathering use cases.
- The `codebase_question` MCP tool description explicitly says the calling agent must still inspect source files directly and do its own reasoning after using the tool.
- The `codebase_question` MCP tool description no longer reads like a general "ask the repo expert to solve this for me" interface.
- `AGENTS.md` explicitly documents that `code_info` usage is retrieval-first: use it to gather evidence, then inspect the codebase directly and reason from that evidence.
- `AGENTS.md` explicitly says `code_info` is not a replacement for code reading, implementation design, risk assessment, or code review performed by the working model.
- The planning-oriented system prompts in `codex_agents/planning_agent/system_prompt.txt`, `codex_agents/vllm_agent/system_prompt.txt`, and `codex_agents/lmstudio_agent/system_prompt.txt` stop telling the agent to use repository-question MCP tooling to "come up with suggestions" or otherwise design the solution on the tool's behalf.
- The planning-oriented command files in `codex_agents/planning_agent/commands/improve_plan.json`, `codex_agents/lmstudio_agent/commands/improve_plan.json`, `codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json`, `codex_agents/vllm_agent/commands/improve_plan.json`, and `codex_agents/vllm_agent/commands/kadshow_improve_plan.json` are updated so repository-question MCP usage is described as evidence gathering, source discovery, and fact finding rather than plan authorship, solution design, coverage judgment, or architecture sign-off.
- The tasking-oriented command file `codex_agents/tasking_agent/commands/task_up.json` is updated so repository-question MCP usage is described as finding existing code, contracts, and evidence, while the tasking agent remains responsible for deciding what to change in the plan.
- The research-oriented prompt in `codex_agents/research_agent/system_prompt.txt` may still encourage broad research, but it frames `code_info` as one retrieval source among others rather than as the authority that decides the final answer.
- Across all updated prompt and command surfaces, wording that asks the tool to decide how to fix an issue, confirm that coverage is sufficient, ensure that edge cases are fully handled, or judge whether a plan is correct is removed or rewritten so that responsibility stays with the calling agent.
- The wording across the MCP tool description, `AGENTS.md`, and the in-scope `codex_agents` files is internally consistent enough that a reader would come away with one clear rule: `codebase_question`/`code_info` helps gather repository evidence, but the working agent must inspect code and reason for itself.
- No server-side prompt rejection, heuristic blocking, or runtime validation is introduced for this story.
- The public MCP method name remains `codebase_question`.
- Existing REST and MCP request and response shapes remain unchanged for this story.
- Documentation updates explain the intended benefit in user terms: the tool reduces search cost, but the working model remains responsible for reasoning.

### Out Of Scope

- Adding runtime prompt rejection or semantic checks for “bad” `codebase_question` requests.
- Renaming the `codebase_question` MCP method.
- Changing answer payload shapes, websocket messages, or transcript rendering.
- Reworking unrelated agent instructions that do not mention repository-search MCP usage.
- Converting every mention of `code_info` in the repository into a long policy explanation if the current wording is already compatible with the retrieval-only rule.
- Changing model selection, provider routing, or token budgeting behavior.
- Adding new MCP repository-search tools beyond clarifying the role of the existing one.

### Questions

None. The story is intentionally guidance-only and the scope-defining decisions are already resolved.

## Wording Contract

The outcome of this story is wording consistency, so the wording rules need to be explicit up front.

Acceptable wording themes for this story:

- `codebase_question` or `code_info` is used to find repository facts, likely files, existing implementations, current contracts, and similar evidence.
- The caller must inspect source files directly after retrieval.
- The caller must decide what to change, what risks exist, whether coverage is adequate, and how to implement the work.

Wording that should be removed or rewritten in this story:

- text that asks the tool to "come up with suggestions" for the implementation;
- text that asks the tool to create or validate the plan itself;
- text that asks the tool to judge whether risk, test coverage, or edge-case coverage is acceptable;
- text that implies the tool is the authoritative decision-maker instead of a retrieval helper.

## Implementation Ideas

- Update the `codebase_question` description in `server/src/mcp2/tools/codebaseQuestion.ts` so it explicitly says:
  - use it for repository facts, file locations, implementation summaries, and likely code areas;
  - do not rely on it to decide how to fix an issue or whether coverage/risk is acceptable;
  - the caller must inspect source files and reason from evidence.
- Update `AGENTS.md` to mirror the same rule in repository-specific instructions.
- Review the in-scope prompt files listed above first, because those are the concrete surfaces already known to contain ambiguous wording.
- Normalize planning-agent wording so it says the MCP tool helps gather repository evidence, while the planning agent still scopes the story and proposes the implementation details.
- Normalize research-agent wording so repository-search MCP usage is one evidence source in a wider investigation, not the authority that decides the root cause or final fix.
- Review command JSON files that currently instruct agents to ask the MCP tool broad advisory questions and rewrite them so they ask for evidence, then direct the agent to continue with manual inspection and its own reasoning.
- When rewriting prompts, prefer short, concrete wording over long policy prose so the prompts remain readable while still enforcing the retrieval-only intent.
- Keep the wording consistent across all surfaces so there is one authoritative mental model for the tool.
- Do not add runtime checks or error paths in this story. The user has explicitly chosen guidance over enforcement.
