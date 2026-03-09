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
- `docs/developer-reference.md`;
- `usefulCommands.txt.md`;
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

If additional prompt or command files are found during implementation that also describe `codebase_question` or `code_info` as a reasoning authority, those files are in scope too. To find those files, search the repository for `code_info`, `codebase_question`, `come up with suggestions`, `100% confident`, `double-check your thoughts`, and wording that asks the tool to decide whether coverage, edge cases, or fixes are correct. Unrelated prompts that do not mention repository-question MCP usage are not part of this story. The current `codex_agents/tasking_agent/system_prompt.txt` conversation-id instruction should be reviewed for consistency, but it only needs changing if the file contains wording that asks `code_info` to decide what to change, judge correctness, or reason on behalf of the tasking agent.

This story is intentionally guidance-only. The user has decided that there should be no runtime prompt rejection, no semantic classifier, and no hard enforcement in server code beyond the wording of the existing tool description and prompt files. The output of this story is therefore consistency and clarity, not a new validation layer.

Research note for scoping:

- MCP tool descriptions and annotations are effectively hints to clients and models, so concise wording matters even though the protocol itself does not enforce behavior.
- OpenAI tool-calling guidance also recommends concise, explicit tool descriptions because the model uses that wording to decide when and how to call a tool.
- That means this story should tighten wording and add lightweight regression checks for the wording contract, but it should not expand into runtime validation or large prompt-governance machinery.

### Acceptance Criteria

- The `codebase_question` MCP tool description in `server/src/mcp2/tools/codebaseQuestion.ts` explicitly says the tool is for repository retrieval, codebase facts, likely file locations, summaries of existing implementations, and similar evidence-gathering use cases.
- The `codebase_question` MCP tool description explicitly says the calling agent must still inspect source files directly and do its own reasoning after using the tool.
- The `codebase_question` MCP tool description no longer reads like a general "ask the repo expert to solve this for me" interface.
- `AGENTS.md` explicitly documents that `code_info` usage is retrieval-first: use it to gather evidence, then inspect the codebase directly and reason from that evidence.
- `AGENTS.md` explicitly says `code_info` is not a replacement for code reading, implementation design, risk assessment, or code review performed by the working model.
- `docs/developer-reference.md` includes a short developer-facing note explaining that `codebase_question` reduces repository search cost but does not replace direct source inspection or reasoning by the working model.
- `usefulCommands.txt.md` is updated anywhere it currently teaches a human operator to use `code_info` as if it should scope the story, design the implementation, or certify correctness on the operator's behalf.
- The planning-oriented system prompts in `codex_agents/planning_agent/system_prompt.txt`, `codex_agents/vllm_agent/system_prompt.txt`, and `codex_agents/lmstudio_agent/system_prompt.txt` stop telling the agent to use repository-question MCP tooling to "come up with suggestions" or otherwise design the solution on the tool's behalf.
- The planning-oriented command files in `codex_agents/planning_agent/commands/improve_plan.json`, `codex_agents/lmstudio_agent/commands/improve_plan.json`, `codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json`, `codex_agents/vllm_agent/commands/improve_plan.json`, and `codex_agents/vllm_agent/commands/kadshow_improve_plan.json` are updated so repository-question MCP usage is described as evidence gathering, source discovery, and fact finding rather than plan authorship, solution design, coverage judgment, or architecture sign-off.
- The tasking-oriented command file `codex_agents/tasking_agent/commands/task_up.json` is updated so repository-question MCP usage is described as finding existing code, contracts, and evidence, while the tasking agent remains responsible for deciding what to change in the plan.
- The research-oriented prompt in `codex_agents/research_agent/system_prompt.txt` may still encourage broad research, but it frames `code_info` as one retrieval source among others rather than as the authority that decides the final answer.
- Across all updated prompt and command surfaces, wording that asks the tool to decide how to fix an issue, confirm that coverage is sufficient, ensure that edge cases are fully handled, or judge whether a plan is correct is removed or rewritten so that responsibility stays with the calling agent.
- The wording across the MCP tool description, `AGENTS.md`, and the in-scope `codex_agents` files is internally consistent enough that a reader would come away with one clear rule: `codebase_question`/`code_info` helps gather repository evidence, but the working agent must inspect code and reason for itself.
- A lightweight regression check is added for the MCP tool definition so a future change to `tools/list` cannot silently broaden the `codebase_question` description back into a general problem-solving tool description.
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
- Adding a heavy prompt-linting or semantic-analysis system for prompt text consistency.
- Changing model selection, provider routing, or token budgeting behavior.
- Adding new MCP repository-search tools beyond clarifying the role of the existing one.

### Questions

None. The story is intentionally guidance-only and the scope-defining decisions are already resolved.

## Message Contracts And Storage Shapes

This story does not introduce any new message contracts, payload shapes, schemas, persisted fields, or runtime storage structures.

The existing MCP tool contract must remain shape-stable:

- tool name remains `codebase_question`;
- input schema fields remain `question`, optional `conversationId`, optional `provider`, and optional `model`;
- provider enum values remain the current supported values only;
- response shape remains `{ conversationId, modelId, segments }`;
- existing invalid-params behavior remains the current MCP error path rather than a new wording-specific validation path.

The only contract-facing change allowed in this story is the human-readable wording:

- the `description` text exposed by `codebaseQuestionDefinition()` and surfaced via `tools/list`;
- the matching guidance text in prompt files, helper text, and developer documentation.

The story must not add or change any of the following:

- Mongo conversation or turn document fields;
- conversation flags or other persisted metadata;
- in-memory registries, caches, or runtime tracking structures;
- websocket message types;
- REST request or response payload shapes;
- MCP request or response payload shapes apart from the tool description text returned in tool metadata.

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

Concrete rewrite examples for this story:

- Replace wording like `use code_info to come up with suggestions about how new features could be implemented` with wording like `use code_info to gather repository evidence about what is already implemented, then inspect the relevant files and decide how the feature should be implemented`.
- Replace wording like `please double-check your thoughts using the code_info tool` with wording like `use code_info to find relevant files, contracts, and existing implementations, then verify your thoughts by reading those files directly`.
- Replace wording like `use code_info to ensure all edge cases are covered` with wording like `use code_info to find related code paths and existing contracts, then assess edge cases yourself`.
- Leave purely operational wording alone when it does not assign reasoning to the tool. Example: a conversation-id instruction such as `use the returned conversationId for follow-up questions` does not need rewriting by itself.

## Completion Checks

The story is complete when a reviewer can confirm all of the following without guessing:

- the in-scope files either use retrieval-first wording or were reviewed and intentionally left unchanged because they only contain operational guidance;
- the MCP tool description, `AGENTS.md`, developer docs, helper text, and agent prompts all communicate the same responsibility boundary;
- repository searches no longer find the old problem patterns in the updated surfaces;
- the lightweight MCP tool-definition regression check covers the retrieval-only contract without snapshotting large prompt text blocks.

Useful repository searches for completion review:

- search for remaining problem phrasing such as `come up with suggestions`, `100% confident`, `double-check your thoughts`, and wording that asks `code_info` to ensure coverage or correctness;
- search for `code_info` and `codebase_question` in the in-scope directories to confirm no overlooked prompt or helper file still frames the tool as the decision-maker.

## Implementation Ideas

### 1. Update the MCP tool definition first

- Edit `server/src/mcp2/tools/codebaseQuestion.ts` in `codebaseQuestionDefinition()` so the description becomes the canonical wording source for the story.
- Keep the change small and explicit:
  - say the tool is for repository facts, likely file locations, implementation summaries, current contracts, and similar evidence-gathering work;
  - say the caller must inspect source files directly after retrieval and do its own reasoning;
  - remove wording that makes the tool sound like a repository expert that should decide the fix.
- Keep the tool shape stable while doing this work:
  - do not rename the tool;
  - do not change `inputSchema`;
  - do not add runtime validation logic just because the wording is being tightened.

### 2. Align the repository-level guidance

- Update `AGENTS.md` immediately after the MCP tool description so the repo instructions match the tool wording.
- Add or update a short note in `docs/developer-reference.md` so the retrieval-only contract is documented outside prompt files as well.
- Review `usefulCommands.txt.md` in the same pass, because it duplicates planning/tasking helper prompts for human operators and can otherwise keep the old "ask code_info to solve it" framing alive.
- Keep these repo-level wording changes concise. The goal is one clear rule that matches the tool description, not a long policy essay.

### 3. Update the prompt families together to avoid drift

- Treat the planning system prompts as one coordinated group:
  - `codex_agents/planning_agent/system_prompt.txt`
  - `codex_agents/vllm_agent/system_prompt.txt`
  - `codex_agents/lmstudio_agent/system_prompt.txt`
- Replace phrases like "come up with suggestions" with retrieval-first language such as "research what is already implemented" or "gather repository evidence."
- Review `codex_agents/research_agent/system_prompt.txt` in the same pass so it still allows broad research but keeps `code_info` as one evidence source rather than the authority that decides the answer.
- Review `codex_agents/tasking_agent/system_prompt.txt` for consistency, but only change it if its surrounding wording starts implying that `code_info` should reason on behalf of the tasking agent. The current conversation-id instruction is not itself the problem.

### 4. Update duplicated command JSON files in grouped passes

- Treat these command files as a high-risk duplication set and update them together so the wording does not drift:
  - `codex_agents/planning_agent/commands/improve_plan.json`
  - `codex_agents/lmstudio_agent/commands/improve_plan.json`
  - `codex_agents/vllm_agent/commands/improve_plan.json`
- Treat the `kadshow` variants as their own small duplication set and update them together:
  - `codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json`
  - `codex_agents/vllm_agent/commands/kadshow_improve_plan.json`
- Update `codex_agents/tasking_agent/commands/task_up.json` separately, because it needs tasking-specific wording:
  - keep `code_info` focused on finding existing code, contracts, and evidence;
  - keep decision-making about plan changes, missing work, and reuse choices with the tasking agent itself.
- When editing JSON prompt content, prefer small wording substitutions over large rewrites so the original command intent stays intact while the responsibility boundary becomes clear.

### 5. Add one lightweight regression check

- Use `server/src/test/unit/mcp2-router-list-happy.test.ts` as the first-choice test location, because it already exercises `tools/list` and sees the published tool definition that clients consume.
- Add a small assertion on the `codebase_question` description rather than a full-text snapshot. The goal is to lock the retrieval-only contract, not to make wording maintenance fragile.
- Prefer checking for a few stable phrases that reflect the contract, such as repository facts/file locations/evidence gathering plus an explicit inspect-and-reason requirement, instead of asserting every word of the description.
- If `tools/list` assertions become awkward, the fallback is a focused test near `server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts`, but router-level coverage is preferable because it validates the surfaced MCP contract.

### 6. Keep the implementation intentionally lightweight

- Prompt and command file consistency can be verified by direct file review in this story; do not introduce a broad repo-wide prompt validator unless implementation uncovers a concrete repeated failure mode that cannot be managed by the scoped file updates above.
- Do not add runtime prompt rejection, heuristic filtering, semantic analysis, or CI machinery just to enforce wording.
- Keep the final wording short and concrete because MCP/OpenAI tool guidance both rely on descriptions as hints that shape model behavior. Overlong policy prose would make the story noisier without making the contract clearer.
