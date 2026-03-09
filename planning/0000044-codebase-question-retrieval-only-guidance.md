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

Terminology for this story is intentionally normalized:

- `codebase_question` is the actual MCP method name exposed by the server;
- `code_info` is legacy repo wording that still appears in prompts, helper text, MCP server names, and error-code naming;
- this story aligns how those surfaces describe repository-question tooling, but it does not rename legacy identifiers that are already part of existing config or error contracts.

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
- Across the updated surfaces, legacy certainty or authority phrases such as `come up with suggestions`, `100% confident`, and `double-check your thoughts` are removed or rewritten whenever they make repository-question tooling sound like the decision-maker.
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
- existing legacy identifier names such as `CODE_INFO_LLM_UNAVAILABLE` remain unchanged in this story.

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
- no updated file treats `codebase_question` and `code_info` as separate tools with different responsibilities;
- repository searches no longer find the old problem patterns in the updated surfaces;
- the lightweight MCP tool-definition regression check covers the retrieval-only contract without snapshotting large prompt text blocks.

Useful repository searches for completion review:

- search for remaining problem phrasing such as `come up with suggestions`, `100% confident`, `double-check your thoughts`, and wording that asks `code_info` to ensure coverage or correctness;
- search for `code_info` and `codebase_question` in the in-scope directories to confirm no overlooked prompt or helper file still frames the tool as the decision-maker.

## Edge Cases and Failure Modes

- Grouped prompt drift: one `improve_plan.json` or `kadshow_improve_plan.json` variant is updated while its sibling files keep the older wording, leaving different agents with conflicting guidance about the same repository-question tool.
- Legacy naming confusion: a file is updated to mention `codebase_question` while another still uses `code_info`, but the wording makes them sound like separate tools instead of legacy names for the same repository-question capability.
- Operational text over-edited: a purely procedural instruction such as conversation-id reuse gets rewritten even though it does not assign reasoning to the tool, causing unnecessary prompt churn and avoidable review noise.
- Partial completion across surfaces: the MCP tool description and `AGENTS.md` are updated, but `docs/developer-reference.md`, `usefulCommands.txt.md`, or one of the agent variants still carries the old "tool as decision-maker" framing.
- Certainty language survives in one variant: phrases such as `come up with suggestions`, `100% confident`, or `double-check your thoughts` remain in one helper file or agent variant and quietly reintroduce the old mental model.
- Research-agent overcorrection: `codex_agents/research_agent/system_prompt.txt` is tightened so much that it no longer supports broad research, even though the intended boundary is narrower: `code_info` should be retrieval-first, but the research agent may still use other sources and do broader investigation.
- Contract creep: a developer attempts to rename `CODE_INFO_LLM_UNAVAILABLE`, change schemas, adjust request/response payloads, or modify transport/runtime behavior while cleaning up wording, even though this story is text-and-test only.
- Weak regression coverage: the MCP tool description is updated but no lightweight description assertion is added, allowing future wording drift; the opposite failure is adding a brittle full-text snapshot that makes harmless wording cleanup unnecessarily hard.
- Hidden helper drift: human-facing helper files such as `usefulCommands.txt.md` are left behind because they are not executable code, even though they continue teaching the old usage pattern.

## Tasking Readiness Notes

This story is intended to be easy to split into implementation tasks later without creating overlap or drift.

Natural work boundaries for later tasking:

- MCP tool definition and its lightweight regression check should stay together, because the description text and the `tools/list` assertion protect the same contract.
- Repository-level guidance files should stay together, because `AGENTS.md`, `docs/developer-reference.md`, and `usefulCommands.txt.md` all explain the rule at a human-operator level.
- The three planning-oriented system prompts should be updated as one coordinated set so they do not drift from each other.
- The duplicated `improve_plan.json` files should be updated together, the duplicated `kadshow_improve_plan.json` files should be updated together, and `task_up.json` should stay separate because its wording is tasking-specific.
- The final consistency review should verify terminology, phrase removal, and the retrieval-only boundary across all updated surfaces before the story is considered done.

Dependencies and sequencing expectations for later tasking:

- Update the MCP tool description first so it acts as the canonical wording source for the rest of the story.
- Update repository docs and helper text before or alongside prompt rewrites so there is always one visible written reference for the desired wording.
- Update duplicated prompt families in grouped passes rather than file-by-file over time.
- Leave schema, transport, storage, and runtime behavior untouched throughout; this is wording alignment work, not behavior work.

## Developer Guardrails

The story should be implementable by a junior developer without extra stakeholder decisions if these guardrails are followed:

- Work from the repository root unless a command explicitly needs a different path.
- Treat this as text-and-test work only. Do not add new APIs, new persistence, new runtime flags, or new prompt-enforcement code.
- When a file uses `code_info`, decide whether it is legacy naming for the same repository-question tool or a purely operational instruction. If it is purely operational, it may stay unchanged.
- When rewriting wording, prefer small substitutions that preserve the file's original purpose. Do not rewrite whole prompts when only the repository-tool responsibility boundary needs changing.
- When validating the story, use the completion checks plus the lightweight MCP tool-description regression check rather than inventing extra validation machinery.

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

## Task Execution Instructions

1. Read this full story before implementation, including Acceptance Criteria, Wording Contract, Completion Checks, Edge Cases and Failure Modes, Tasking Readiness Notes, Developer Guardrails, and Implementation Ideas.
2. Work tasks strictly in numeric order. Do not start a later task until the current task is fully complete and documented.
3. This story is wording-and-test work only. Do not add runtime prompt rejection, new storage, websocket changes, REST changes, schema changes, or extra observability/logging just to support validation.
4. For each task, set Task Status to `__in_progress__` before touching files, and set it to `__done__` only after subtasks, testing, and implementation notes are complete.
5. Keep the `codebase_question` tool name, input schema, result shape, provider enum values, and existing legacy identifiers such as `CODE_INFO_LLM_UNAVAILABLE` unchanged throughout this story.
6. When a subtask says to search for wording drift, use repository search and inspect the matching files directly before editing. Only update files that actually frame `code_info` or `codebase_question` as a reasoning authority.
7. When a subtask says to keep grouped files aligned, make the wording changes in the whole group within the same task so the duplicated prompts do not drift.
8. Do not add new test files unless the named existing test location cannot express the required check cleanly. Prefer the existing server test files already identified in this story.
9. If a task touches only text files and does not change runtime code or automated tests, wrapper test commands are not required for that task. Record that explicitly instead of inventing runtime validation.
10. After each completed subtask or testing step, update the task’s Implementation notes with what changed, any wording decisions, and any search terms used to prove the old authority-style phrases were removed.
11. After Task 1 establishes the final MCP tool wording, reuse the same stable phrase set and responsibility boundary plus the existing `AGENTS.md` rule `After code_info, inspect the local code directly with repository search and file reads as needed.` across the later prompt and command tasks. Keep the meaning aligned, but do not force an identical sentence structure into files where a lighter rewrite is clearer.
12. Repository inspection plus current library-doc checks for this story confirm that no React, MUI component, websocket, REST route, Mongo, Mongoose, compose, or client-side implementation changes are required. If implementation starts to touch those areas, treat that as scope drift and stop to update the story rather than silently widening it.
13. For non-MUI API or SDK questions, consult Context7 first when it is available. If Context7 or DeepWiki is unavailable for a relevant library or repository, use the official documentation URLs already listed in the task and record the tool outage in Implementation notes. MUI docs were checked for this story and found no component-level relevance.
14. Minimum junior workflow for any subtask in this story: open the exact files named in the subtask with `sed -n '1,220p' <file>`, search for the named phrases with `rg -n '<phrase>' <file>`, make the smallest possible wording-only edit, then confirm the final scope with `git diff -- <file>`. If a subtask names more than one file, run the same pattern for each named file before editing.
15. Keep this stable phrase set in front of you while working any wording-edit subtask: `repository facts`, `likely file locations`, `summaries of existing implementations`, `current contracts`, `evidence-gathering`, `inspect source files directly after retrieval`, and `do its own reasoning`. The goal is to reuse this responsibility boundary consistently, not to invent broader or more authoritative wording.
16. If any task in this story unexpectedly changes architecture or adds a flow, add a same-task subtask to update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) before the task is marked complete. That `design.md` update must explain the architecture or flow change and include any new or changed Mermaid diagrams needed to keep the document accurate.
17. If a task needs Mermaid diagrams, use the Context7 Mermaid reference at https://context7.com/mermaid-js/mermaid so diagram syntax matches the Mermaid specification used by the repository documentation.
18. If any task adds or removes tracked files, add a same-task subtask to update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after all file add/remove subtasks are complete. That `projectStructure.md` update must list every tracked file added or removed by that task, not just the first one noticed.
19. Keep `Documentation Locations` external-only. Repository file paths, repository searches, and exact files to read or edit belong in the subtasks, not in the documentation list. If this story is re-tasked again later, preserve that separation.
20. Story 44 is not browser-facing and must not add new client/runtime debug markers. For every task below, the Manual Playwright-MCP check is expected to confirm that the task-specific prefix listed in that task’s subtasks does not appear in the browser console at all. If any new `[DEV-0000044][Tn]` browser log line appears, treat it as scope drift and fail the task until the story is re-planned.
21. If any task unexpectedly starts changing a GUI-visible front-end path, add task-specific Manual Playwright-MCP instructions for that task before implementation is considered complete. Those instructions must tell the implementer to capture one or more screenshots, store them in `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local`, and review the images directly to confirm the GUI matches the task expectations. That folder is mapped for Playwright artifacts in `docker-compose.local.yml`, so do not use another output path.

## Tasks

### 1. MCP Tool Description Contract

- Task Status: `__done__`
- Git Commits: `e264d306`

#### Overview

Update the published `codebase_question` tool description so it clearly describes a retrieval-only helper and add one lightweight regression assertion for the surfaced MCP contract. This task is first because later prompt and documentation wording should align to the server-published description instead of inventing their own phrasing.

#### Documentation Locations

- Model Context Protocol tools concept and server behavior: https://modelcontextprotocol.io/docs/learn/server-concepts
- OpenAI function calling guide, for concise tool-description wording that helps the model choose tools correctly: https://platform.openai.com/docs/guides/function-calling
- OpenAI tools and MCP guide, for how tool metadata shapes model behavior without adding hard enforcement: https://platform.openai.com/docs/guides/tools-connectors-mcp
- DeepWiki indexed repo page for `openai/openai-node`: https://deepwiki.com/openai/openai-node, because its `Function Calling and Tools` section provides secondary confirmation that natural-language tool descriptions guide model tool choice while structured parameters still define the contract.
- Node.js `node:test` API, because this task updates an existing Node test file rather than adding a new test framework: https://nodejs.org/docs/latest-v22.x/api/test.html
- npm run-script command reference, because all validation in this task must be executed through repository wrapper scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://modelcontextprotocol.io/docs/learn/server-concepts`, `https://platform.openai.com/docs/guides/function-calling`, and `https://platform.openai.com/docs/guides/tools-connectors-mcp` open while working, and reuse the stable phrase set `repository facts`, `likely file locations`, `summaries of existing implementations`, `current contracts`, `inspect source files directly`, and `do its own reasoning`.

1. [x] Read the documentation links above, then inspect [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts), [server/src/mcp2/tools.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools.ts), [server/src/test/unit/mcp2-router-list-happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp2-router-list-happy.test.ts), [server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/mcp2/tools/codebaseQuestion.validation.test.ts), and [server/src/test/unit/mcp2-router-list-unavailable.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp2-router-list-unavailable.test.ts). Confirm before editing that this task changes only the human-readable `description` metadata surfaced by `tools/list`, and that runtime tool execution still routes by tool name rather than by description content. Junior copy/paste snippet for this subtask: `sed -n '560,660p' server/src/mcp2/tools/codebaseQuestion.ts`, `sed -n '1,120p' server/src/mcp2/tools.ts`, `sed -n '1,140p' server/src/test/unit/mcp2-router-list-happy.test.ts`, `rg -n 'description|codebase_question|tools/list' server/src/mcp2/tools/codebaseQuestion.ts server/src/mcp2/tools.ts server/src/test/unit/mcp2-router-list-happy.test.ts`.
2. [x] Edit [server/src/mcp2/tools/codebaseQuestion.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mcp2/tools/codebaseQuestion.ts) so `codebaseQuestionDefinition()` describes `codebase_question` as a retrieval helper for repository facts, likely file locations, summaries of existing implementations, current contracts, and similar evidence-gathering work. The new wording must also say the caller must inspect source files directly after retrieval and do its own reasoning. Do not rename the tool, change `inputSchema`, change returned data, or add runtime validation.
3. [x] Test type: `node:test` unit happy-path metadata regression. Location: [server/src/test/unit/mcp2-router-list-happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp2-router-list-happy.test.ts). Description and purpose: add the first description-content assertion in this file so the published `codebase_question` description returned from `tools/list` includes a few stable retrieval-first phrases plus the inspect-and-reason requirement. This protects the happy path clients consume without creating a brittle full-text snapshot.
4. [x] Test type: `node:test` unit happy-path contract-shape regression. Location: [server/src/test/unit/mcp2-router-list-happy.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp2-router-list-happy.test.ts). Description and purpose: add or update explicit assertions that the published tool name is still `codebase_question`, `inputSchema.required` still contains only `question`, and the optional schema fields `conversationId`, `provider`, and `model` are still present. This prevents the wording story from silently changing the public MCP contract while the metadata text is being edited.
5. [x] Test type: `node:test` unit availability-path regression review. Location: [server/src/test/unit/mcp2-router-list-unavailable.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/mcp2-router-list-unavailable.test.ts) plus any matching files under `server/src/test`. Description and purpose: run a direct text search for `codebase_question` in `server/src/test`, re-check the unavailable-path test, and confirm the story did not change availability behavior, tool naming, or other test assumptions. There are no existing server tests that assert on description wording today, so record that this review is guarding behavior and naming consistency rather than rewriting old description assertions.
6. [x] File-structure documentation follow-through. Location: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Description and purpose: if this task ends up adding or removing any tracked test file while using the fallback path described above, update `projectStructure.md` only after all file add/remove work in this task is finished and make sure the document lists every tracked file added or removed by Task 1. If no files were added or removed, record that `projectStructure.md` stayed unchanged on purpose.
7. [x] Record in this task’s Implementation notes that the description change affects `tools/list` metadata only, list the exact stable phrases used by the happy-path metadata regression, and explain why they were chosen instead of a full-text snapshot.
8. [x] Manual Playwright-MCP log contract for Task 1. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T1]` and zero browser `error` entries caused by this story, because Task 1 only changes MCP metadata and server-side tests. Do not add any new client/runtime log line such as `[DEV-0000044][T1] event=mcp_tool_description_contract_aligned result=success`. Record this expected zero-match outcome in Implementation notes so the final Playwright check has a concrete pass/fail rule.
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts. This preserves tokens while keeping full diagnostics available.

1. [x] `npm run build:summary:server` - Use because this task changes server code and server tests. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server `node:test` unit/integration coverage because server behavior and server test expectations change in this task. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber coverage because this task changes server-exposed MCP metadata and final server-side wrapper validation should still pass at the task level. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Read the MCP, OpenAI tools/function-calling, Node `node:test`, npm run-script, and DeepWiki references plus the existing server/router tests before editing.
- Confirmed `codebaseQuestionDefinition().description` is surfaced by `tools/list`, while `callTool()` still dispatches by `CODEBASE_QUESTION_TOOL_NAME`; Task 1 stays metadata-only.
- Updated the published `codebase_question` description to use the retrieval-first phrase set: `repository facts`, `likely file locations`, `summaries of existing implementations`, `current contracts`, `inspect the relevant source files directly`, and `do your own reasoning`.
- Added router-list assertions for those stable phrases plus the inspect-and-reason boundary instead of a full-text snapshot, so harmless wording cleanup stays cheap while the contract remains protected.
- Extended the happy-path router test to assert the public tool name is still `codebase_question`, `inputSchema.required` is still only `question`, and `conversationId`/`provider`/`model` remain optional schema properties.
- Re-checked `server/src/test/unit/mcp2-router-list-unavailable.test.ts` and a direct `rg` over `server/src/test`; no old description assertions existed, and availability behavior/naming stayed unchanged.
- No tracked files were added or removed in Task 1, so `projectStructure.md` intentionally stayed unchanged.
- Recorded the Manual Playwright expectation for later story validation: zero `[DEV-0000044][T1]` browser-console entries and zero browser `error` entries caused by Task 1, because this task changes metadata and server-side tests only.
- `npm run build:summary:server` passed cleanly with `agent_action: skip_log`; no build-log inspection was needed.
- `npm run lint --workspaces` completed with existing repo-wide import-order warnings outside Task 1; `npm run format:check --workspaces` initially failed on `server/src/chat/interfaces/ChatInterfaceLMStudio.ts`, so I ran `npx prettier --write` on that file plus the Task 1 touched files and then reran `format:check` to a clean pass.
- `npm run test:summary:server:unit` passed cleanly with 1017/1017 tests passing and `agent_action: skip_log`; no unit-test log inspection was needed.
- `npm run test:summary:server:cucumber` passed cleanly with 68/68 tests passing and `agent_action: skip_log`; no cucumber-log inspection was needed.

---

### 2. Repository Guidance

- Task Status: `__done__`
- Git Commits: `cc7a383f`

#### Overview

Align the repository-level guidance so `AGENTS.md` and the developer reference both describe `code_info` as retrieval-first and do not ask it to decide the implementation. This task is intentionally limited to the canonical repo documentation surfaces so they are settled before the helper-command library and prompt families are updated.

#### Documentation Locations

- Model Context Protocol tools concept and server behavior: https://modelcontextprotocol.io/docs/learn/server-concepts
- OpenAI function calling guide, for concise wording that keeps tool descriptions and operator guidance aligned: https://platform.openai.com/docs/guides/function-calling
- OpenAI tools and MCP guide, for the retrieval-helper mental model used by models and operators: https://platform.openai.com/docs/guides/tools-connectors-mcp
- Markdown Guide basic syntax reference, because this task edits markdown-heavy repository guidance files and should preserve valid formatting: https://www.markdownguide.org/basic-syntax/

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://modelcontextprotocol.io/docs/learn/server-concepts`, `https://platform.openai.com/docs/guides/function-calling`, `https://platform.openai.com/docs/guides/tools-connectors-mcp`, and `https://www.markdownguide.org/basic-syntax/` open while working. `AGENTS.md` may already be sufficiently retrieval-first, so only edit it if the final Task 1 wording proves there is still a mismatch.

1. [x] Read the documentation links above, then inspect [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md), [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md), and [planning/0000025-summary-first-retrieval.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000025-summary-first-retrieval.md). Confirm the exact wording that already frames repository-question tooling as retrieval-first before editing the canonical repo guidance files. Junior copy/paste snippet for this subtask: `sed -n '1,140p' AGENTS.md`, `sed -n '120,220p' docs/developer-reference.md`, `rg -n 'code_info|codebase_question|inspect the local code directly|repository facts' AGENTS.md docs/developer-reference.md planning/0000025-summary-first-retrieval.md`.
2. [x] Review [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md) against the final Task 1 MCP wording. Only update the file if it still diverges from the retrieval-first boundary after Task 1 is complete; otherwise leave it unchanged and record in Implementation notes that it was already aligned enough. If an edit is needed, keep the existing onboarding flow and conversation-id rules intact and treat the file as the human-facing canonical wording source that later prompt tasks should mirror.
3. [x] Add or update a short note in [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md) explaining that `codebase_question` reduces repository-search cost but does not replace source inspection, implementation design, risk assessment, or review by the working model. Reuse the stable phrases from Task 1 and the updated `AGENTS.md` wording instead of inventing new synonyms.
4. [x] Run repository searches for `code_info`, `codebase_question`, `repository facts`, and `inspect the local code directly` across [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md) and [docs/developer-reference.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/docs/developer-reference.md). In the same pass, compare the final `AGENTS.md` wording side by side with the Task 1 MCP description and record in Implementation notes whether `AGENTS.md` stayed unchanged or was minimally edited, plus why that leaves the two surfaces aligned enough.
5. [x] Manual Playwright-MCP log contract for Task 2. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T2]` and zero browser `error` entries caused by this story, because Task 2 only changes repository markdown guidance. Do not add any new client/runtime log line such as `[DEV-0000044][T2] event=repository_guidance_aligned result=success`. Record this expected zero-match outcome in Implementation notes.
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using repository wrapper commands.
No wrapper build or automated test run is required for this task because it changes only markdown/text guidance files. Validation for this task is the wording search and file review completed in the subtasks above. Full wrapper regression is deferred to the final story task.

#### Implementation notes

- Read the MCP/OpenAI/Markdown references, compared `AGENTS.md`, `docs/developer-reference.md`, and Story 25 retrieval wording, and searched for `code_info`, `codebase_question`, `repository facts`, and `inspect the local code directly` before editing.
- Left `AGENTS.md` unchanged because it already says to use `code_info` first and then inspect the local code directly with repository search and file reads as needed, which stays aligned with the Task 1 MCP wording.
- Added a short retrieval-boundary note to `docs/developer-reference.md` that frames `codebase_question` / `code_info` as repository-search help for repository facts, likely file locations, summaries of existing implementations, and current contracts, followed by direct source inspection and model reasoning.
- Kept the change scoped to canonical repo guidance only; onboarding flow and conversation-id instructions in `AGENTS.md` were intentionally left untouched.
- Recorded the Manual Playwright expectation for later story validation: zero `[DEV-0000044][T2]` browser-console entries and zero browser `error` entries caused by Task 2, because this task changes markdown guidance only.
- `npm run format:check --workspaces` passed cleanly; `npm run lint --workspaces` still reported the existing repo-wide import-order warnings outside Task 2 and did not introduce any Task 2-specific failures.

---

### 3. Operator Helper Command Library

- Task Status: `__done__`
- Git Commits: `6927d6f5`

#### Overview

Update the human operator helper text in `usefulCommands.txt.md` so it matches the same retrieval-first rule as the canonical repo guidance. This is kept separate because the file is a reusable operator command library rather than a system prompt or a runtime-facing document.

#### Documentation Locations

- Model Context Protocol tools concept and server behavior: https://modelcontextprotocol.io/docs/learn/server-concepts
- OpenAI function calling guide, for concise wording that keeps tool descriptions and operator guidance aligned: https://platform.openai.com/docs/guides/function-calling
- OpenAI tools and MCP guide, for the retrieval-helper mental model used by models and operators: https://platform.openai.com/docs/guides/tools-connectors-mcp
- Context7 API Guide: https://context7.com/docs/api-guide, because it documents library search, context retrieval, version pinning, and error handling for the Context7 MCP-backed documentation workflow that this helper text names.
- DeepWiki documentation site: https://deepwiki.com, because the helper text explicitly names DeepWiki as a research source and the wording must keep that role accurate.
- Markdown Guide basic syntax reference, because this task edits a markdown-heavy operator helper file and should preserve valid formatting: https://www.markdownguide.org/basic-syntax/

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://modelcontextprotocol.io/docs/learn/server-concepts`, `https://platform.openai.com/docs/guides/function-calling`, `https://platform.openai.com/docs/guides/tools-connectors-mcp`, `https://context7.com/docs/api-guide`, `https://deepwiki.com`, and `https://www.markdownguide.org/basic-syntax/` open while working. The only file in scope here is [usefulCommands.txt.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/usefulCommands.txt.md), and the goal is to remove certainty or authority wording without changing the file’s command-library structure.

1. [x] Read the documentation links above, then inspect [usefulCommands.txt.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/usefulCommands.txt.md) alongside the updated [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md). Confirm which entries currently ask `code_info` to make the plan, certify correctness, or make the operator `100% confident`. Junior copy/paste snippet for this subtask: `sed -n '1,120p' usefulCommands.txt.md`, `rg -n '100% confident|double check your thoughts|double-check your thoughts|code_info' usefulCommands.txt.md AGENTS.md`.
2. [x] Rewrite only the relevant entries in [usefulCommands.txt.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/usefulCommands.txt.md) so they reuse the stable Task 1 / `AGENTS.md` retrieval-first wording instead of asking `code_info` to decide the answer. Keep the file’s command-library purpose and overall structure intact.
3. [x] Search [usefulCommands.txt.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/usefulCommands.txt.md) for `100% confident`, `double check your thoughts`, `double-check your thoughts`, `come up with suggestions`, and `code_info`. Record in Implementation notes which phrases were removed, which were rewritten, and which remaining `code_info` mentions are intentionally operational-only.
4. [x] Manual Playwright-MCP log contract for Task 3. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T3]` and zero browser `error` entries caused by this story, because Task 3 only changes operator helper text. Do not add any new client/runtime log line such as `[DEV-0000044][T3] event=operator_helper_guidance_aligned result=success`. Record this expected zero-match outcome in Implementation notes.
5. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using repository wrapper commands.
No wrapper build or automated test run is required for this task because it changes helper-text only. Validation for this task is the wording search and file review completed in the subtasks above. Full wrapper regression is deferred to the final story task.

#### Implementation notes

- Read the MCP/OpenAI/Context7/DeepWiki/Markdown references, inspected `usefulCommands.txt.md` beside `AGENTS.md`, and searched for `100% confident`, `double check your thoughts`, `double-check your thoughts`, `come up with suggestions`, and `code_info` before editing.
- Rewrote the helper entry that asked for cross-tool research “to be 100% confident of the answer” so it now frames `code_info` as evidence gathering for repository facts, relevant docs, and other facts before deciding on the answer.
- Rewrote the helper entry that said “Please double check your thoughts using the code_info, deepwiki and context7 mcp tools” so it now says to gather repository evidence and relevant documentation, then verify thoughts by reading the relevant files directly.
- Left the remaining `code_info` mentions in the long delegation instructions unchanged because they are operational workflow guidance rather than authority-style wording.
- Recorded the Manual Playwright expectation for later story validation: zero `[DEV-0000044][T3]` browser-console entries and zero browser `error` entries caused by Task 3, because this task changes operator helper text only.
- `npm run format:check --workspaces` passed cleanly; `npm run lint --workspaces` still reported the existing repo-wide import-order warnings outside Task 3 and did not introduce any Task 3-specific failures.

---

### 4. Planning Agent System Prompt Family

- Task Status: `__done__`
- Git Commits: `519d5e39`

#### Overview

Align the three planning-oriented system prompts so they all describe `code_info` as a retrieval helper rather than a source of implementation suggestions. This is a dedicated task because the files are duplicated prompt-family surfaces that should be kept in sync in one pass.

#### Documentation Locations

- OpenAI function calling guide, for wording that keeps tool use concise and responsibility with the caller: https://platform.openai.com/docs/guides/function-calling
- OpenAI tools and MCP guide, for how tool guidance should support model tool selection without becoming a substitute for reasoning: https://platform.openai.com/docs/guides/tools-connectors-mcp
- Context7 API Guide: https://context7.com/docs/api-guide, because it documents library search, context retrieval, version pinning, and error handling for the Context7 MCP-backed documentation workflow that these prompts name.
- DeepWiki documentation site: https://deepwiki.com, because these system prompts explicitly name DeepWiki and the wording must keep its role as a repository research source rather than a decision-maker.
- Model Context Protocol tools concept and server behavior: https://modelcontextprotocol.io/docs/learn/server-concepts
- Plain text file handling on GitHub and Markdown repositories, to preserve line-oriented prompt formatting with minimal edits: https://docs.github.com/en/get-started/writing-on-github

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://platform.openai.com/docs/guides/function-calling`, `https://platform.openai.com/docs/guides/tools-connectors-mcp`, `https://context7.com/docs/api-guide`, `https://deepwiki.com`, and `https://modelcontextprotocol.io/docs/learn/server-concepts` open while working. All three system-prompt files in this task should stay materially aligned after editing, and any change should preserve the surrounding planning-agent behavior.

1. [x] Read the documentation links above, then inspect [codex_agents/planning_agent/system_prompt.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/planning_agent/system_prompt.txt), [codex_agents/vllm_agent/system_prompt.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/vllm_agent/system_prompt.txt), and [codex_agents/lmstudio_agent/system_prompt.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/lmstudio_agent/system_prompt.txt). Confirm the shared phrase `come up with suggestions about how new features could be implemented` appears in all three files before editing. Junior copy/paste snippet for this subtask: `sed -n '1,80p' codex_agents/planning_agent/system_prompt.txt`, `sed -n '1,80p' codex_agents/vllm_agent/system_prompt.txt`, `sed -n '1,80p' codex_agents/lmstudio_agent/system_prompt.txt`, `rg -n 'come up with suggestions|code_info' codex_agents/planning_agent/system_prompt.txt codex_agents/vllm_agent/system_prompt.txt codex_agents/lmstudio_agent/system_prompt.txt`.
2. [x] Update all three planning system prompts in the same edit pass so they tell the agent to use `code_info` to gather repository evidence, current implementations, and candidate files, then inspect those files directly and reason for itself. Reuse the same stable phrase set and responsibility boundary established in Task 1 and the updated `AGENTS.md` wording rather than inventing per-file variants. Keep the broader planning-agent role, KISS instructions, and question-asking behavior unchanged.
3. [x] After editing, compare the three files side by side and confirm the retrieval-only sentence stays materially identical across all variants so the family does not drift.
4. [x] Search these three files for `come up with suggestions`, `100% confident`, `double-check your thoughts`, and `code_info` and record in Implementation notes which wording was changed and which operational wording stayed unchanged.
5. [x] Manual Playwright-MCP log contract for Task 4. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T4]` and zero browser `error` entries caused by this story, because Task 4 only changes agent prompt text. Do not add any new client/runtime log line such as `[DEV-0000044][T4] event=planning_prompt_family_aligned result=success`. Record this expected zero-match outcome in Implementation notes.
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using repository wrapper commands.
No wrapper build or automated test run is required for this task because it changes prompt text only. Validation for this task is the side-by-side comparison and wording searches completed in the subtasks above. Full wrapper regression is deferred to the final story task.

#### Implementation notes

- Read the OpenAI/Context7/DeepWiki/MCP/GitHub Docs references, inspected all three planning prompt variants together, and confirmed the shared `come up with suggestions about how new features could be implemented` phrase appeared in each file before editing.
- Replaced that shared sentence in `planning_agent`, `vllm_agent`, and `lmstudio_agent` with one materially identical retrieval-first sentence that tells the agent to gather repository evidence, current implementations, and candidate files, then inspect those files directly and reason for itself.
- Kept the surrounding planning-agent behavior unchanged, including the KISS rules, question-asking pattern, and “do not create tasks” instructions.
- Post-edit searches confirmed the old `come up with suggestions` wording was removed from all three files; no `100% confident` or `double-check your thoughts` wording was present in this prompt family to rewrite.
- Recorded the Manual Playwright expectation for later story validation: zero `[DEV-0000044][T4]` browser-console entries and zero browser `error` entries caused by Task 4, because this task changes prompt text only.
- `npm run format:check --workspaces` passed cleanly; `npm run lint --workspaces` still reported the existing repo-wide import-order warnings outside Task 4 and did not introduce any Task 4-specific failures.

---

### 5. Improve Plan Command Family

- Task Status: `__done__`
- Git Commits: `588922cf`

#### Overview

Align the three standard `improve_plan.json` command files so they frame repository-question tooling as evidence gathering rather than plan authorship or correctness sign-off. This task now covers only the standard family so it stays smaller and easier to validate.

#### Documentation Locations

- OpenAI function calling guide, for concise task instructions that keep reasoning with the calling agent: https://platform.openai.com/docs/guides/function-calling
- OpenAI tools and MCP guide, for retrieval-helper framing and concise tool-guidance wording: https://platform.openai.com/docs/guides/tools-connectors-mcp
- Context7 API Guide: https://context7.com/docs/api-guide, because it documents library search, context retrieval, version pinning, and error handling for the Context7 MCP-backed documentation workflow that these command files name.
- DeepWiki documentation site: https://deepwiki.com, because these command files explicitly name DeepWiki and the wording must keep its role as a repository research source rather than an authority.
- JSON RFC overview, because this task edits JSON string content and must preserve valid JSON syntax and escaping: https://www.rfc-editor.org/rfc/rfc8259
- npm run-script command reference, because task validation still uses repository wrapper scripts for formatting/linting: https://docs.npmjs.com/cli/v10/commands/npm-run-script

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://platform.openai.com/docs/guides/function-calling`, `https://platform.openai.com/docs/guides/tools-connectors-mcp`, `https://context7.com/docs/api-guide`, `https://deepwiki.com`, and `https://www.rfc-editor.org/rfc/rfc8259` open while working. This task edits three JSON command files, so each wording change must be followed by the per-file JSON parse checks described in the subtasks below.

1. [x] Read the documentation links above, then inspect [codex_agents/planning_agent/commands/improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/planning_agent/commands/improve_plan.json), [codex_agents/lmstudio_agent/commands/improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/lmstudio_agent/commands/improve_plan.json), and [codex_agents/vllm_agent/commands/improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/vllm_agent/commands/improve_plan.json). Confirm which strings currently use phrases such as `100% confident`, `double check your thoughts`, `double-check your thoughts`, and `ensure all edge cases and failure modes are covered`, or otherwise ask `code_info` to ensure correctness or coverage. Junior copy/paste snippet for this subtask: `sed -n '1,120p' codex_agents/planning_agent/commands/improve_plan.json`, `sed -n '1,120p' codex_agents/lmstudio_agent/commands/improve_plan.json`, `sed -n '1,120p' codex_agents/vllm_agent/commands/improve_plan.json`, `rg -n '100% confident|double check|double-check|ensure all edge cases|code_info' codex_agents/planning_agent/commands/improve_plan.json codex_agents/lmstudio_agent/commands/improve_plan.json codex_agents/vllm_agent/commands/improve_plan.json`.
2. [x] Update the three `improve_plan.json` files so any `code_info` instruction is phrased as finding repository facts, existing implementations, contracts, and candidate files for the planning agent to reason about. Reuse the same stable phrase set from Task 1 and `AGENTS.md` where it fits, and do not rewrite unrelated command steps or rename command entries.
3. [x] Search the three standard command files for `100% confident`, `double check your thoughts`, `double-check your thoughts`, `come up with suggestions`, `ensure all edge cases`, and `code_info`. Record in Implementation notes which strings were rewritten and confirm that the three standard variants still match each other after editing.
4. [x] Specific file validation needed before wrapper testing. Confirm [codex_agents/planning_agent/commands/improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/planning_agent/commands/improve_plan.json), [codex_agents/lmstudio_agent/commands/improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/lmstudio_agent/commands/improve_plan.json), and [codex_agents/vllm_agent/commands/improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/vllm_agent/commands/improve_plan.json) still parse as JSON after the wording edit by running `node -e "JSON.parse(require('fs').readFileSync('codex_agents/planning_agent/commands/improve_plan.json', 'utf8'));"`, `node -e "JSON.parse(require('fs').readFileSync('codex_agents/lmstudio_agent/commands/improve_plan.json', 'utf8'));"`, and `node -e "JSON.parse(require('fs').readFileSync('codex_agents/vllm_agent/commands/improve_plan.json', 'utf8'));"`. Record the clean parse result for all three files in Implementation notes so quote or escape regressions are not missed.
5. [x] Manual Playwright-MCP log contract for Task 5. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T5]` and zero browser `error` entries caused by this story, because Task 5 only changes command-template JSON text. Do not add any new client/runtime log line such as `[DEV-0000044][T5] event=improve_plan_command_family_aligned result=success`. Record this expected zero-match outcome in Implementation notes.
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using repository wrapper commands.
No wrapper build or automated test run is required for this task because it changes command-template text only. Validation for this task is the wording search and JSON parse checks completed in the subtasks above. Full wrapper regression is deferred to the final story task.

#### Implementation notes

- Set Task 5 to `__in_progress__`, inspected all three standard `improve_plan.json` files, and confirmed the current authority-style wording lives in the `100% confident`, `double check your thoughts` / `double-check your thoughts`, contract-coverage, and edge-case-coverage prompts.
- Rewrote the three standard `improve_plan.json` variants together so the research, implementation-ideas, contracts/storage, and edge-case prompts now frame `code_info` as retrieval for repository facts, likely file locations, existing implementations, current contracts, and candidate files before the planning agent inspects source files directly and does its own reasoning.
- Post-edit searches confirmed the old `100% confident`, `double check your thoughts`, `double-check your thoughts`, and `ensure all edge cases` authority wording was removed from the standard family; no `come up with suggestions` phrasing existed in these files, and the remaining `code_info` mentions are operational retrieval instructions.
- Ran the required per-file JSON parse checks and got clean results for all three standard variants: `planning_ok`, `lmstudio_ok`, and `vllm_ok`.
- Recorded the Manual Playwright expectation for later story validation: zero `[DEV-0000044][T5]` browser-console entries and zero browser `error` entries caused by Task 5, because this task changes command-template JSON text only.
- `npm run format:check --workspaces` passed cleanly; `npm run lint --workspaces` completed with the same existing repo-wide import-order warnings outside Task 5 and did not surface any Task 5-specific failures.

---

### 6. Kadshow Plan Command Variants

- Task Status: `__done__`
- Git Commits: `936a1e2a`

#### Overview

Align the two `kadshow_improve_plan.json` variants so they use the same retrieval-first boundary as the standard planning command family. This is split out from Task 5 because the files are a smaller duplicated set with their own wording drift risk.

#### Documentation Locations

- OpenAI function calling guide, for concise task instructions that keep reasoning with the calling agent: https://platform.openai.com/docs/guides/function-calling
- OpenAI tools and MCP guide, for retrieval-helper framing and concise tool-guidance wording: https://platform.openai.com/docs/guides/tools-connectors-mcp
- Context7 API Guide: https://context7.com/docs/api-guide, because it documents library search, context retrieval, version pinning, and error handling for the Context7 MCP-backed documentation workflow that these command files name.
- DeepWiki documentation site: https://deepwiki.com, because these command files explicitly name DeepWiki and the wording must keep its role as a repository research source rather than an authority.
- JSON RFC overview, because this task edits JSON string content and must preserve valid JSON syntax and escaping: https://www.rfc-editor.org/rfc/rfc8259
- npm run-script command reference, because task validation still uses repository wrapper scripts for formatting/linting: https://docs.npmjs.com/cli/v10/commands/npm-run-script

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://platform.openai.com/docs/guides/function-calling`, `https://platform.openai.com/docs/guides/tools-connectors-mcp`, `https://context7.com/docs/api-guide`, `https://deepwiki.com`, and `https://www.rfc-editor.org/rfc/rfc8259` open while working. This task edits two JSON command files, and both variants must stay materially aligned after the wording changes.

1. [x] Read the documentation links above, then inspect [codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json) and [codex_agents/vllm_agent/commands/kadshow_improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/vllm_agent/commands/kadshow_improve_plan.json). Confirm which strings currently use phrases such as `100% confident`, `double check your thoughts`, `double-check your thoughts`, and `ensure all edge cases and failure modes are covered`, or otherwise ask `code_info` to ensure correctness or coverage. Junior copy/paste snippet for this subtask: `sed -n '1,120p' codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json`, `sed -n '1,120p' codex_agents/vllm_agent/commands/kadshow_improve_plan.json`, `rg -n '100% confident|double check|double-check|ensure all edge cases|code_info' codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json codex_agents/vllm_agent/commands/kadshow_improve_plan.json`.
2. [x] Update both `kadshow_improve_plan.json` files in the same edit pass so they reuse the same Task 1 / `AGENTS.md` wording patterns as the standard `improve_plan.json` family. Preserve their command structure and only change the strings that assign reasoning authority or certainty to the tool.
3. [x] Search both `kadshow` command files for `100% confident`, `double check your thoughts`, `double-check your thoughts`, `come up with suggestions`, `ensure all edge cases`, and `code_info`. Record in Implementation notes which strings were rewritten and confirm that the two variants still match each other after editing.
4. [x] Specific file validation needed before wrapper testing. Confirm [codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json) and [codex_agents/vllm_agent/commands/kadshow_improve_plan.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/vllm_agent/commands/kadshow_improve_plan.json) still parse as JSON after the wording edit by running `node -e "JSON.parse(require('fs').readFileSync('codex_agents/lmstudio_agent/commands/kadshow_improve_plan.json', 'utf8'));"` and `node -e "JSON.parse(require('fs').readFileSync('codex_agents/vllm_agent/commands/kadshow_improve_plan.json', 'utf8'));"`. Record the clean parse result for both files in Implementation notes so quote or escape regressions are not missed.
5. [x] Manual Playwright-MCP log contract for Task 6. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T6]` and zero browser `error` entries caused by this story, because Task 6 only changes `kadshow` command-template JSON text. Do not add any new client/runtime log line such as `[DEV-0000044][T6] event=kadshow_command_family_aligned result=success`. Record this expected zero-match outcome in Implementation notes.
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using repository wrapper commands.
No wrapper build or automated test run is required for this task because it changes command-template text only. Validation for this task is the wording search and JSON parse checks completed in the subtasks above. Full wrapper regression is deferred to the final story task.

#### Implementation notes

- Set Task 6 to `__in_progress__`, inspected both `kadshow_improve_plan.json` variants, and confirmed the current authority-style wording lives in the `100% confident`, `double check your thoughts`, and contract-coverage prompts.
- Rewrote both `kadshow_improve_plan.json` variants together so the research, implementation-ideas, and contracts/storage prompts now frame `code_info` as retrieval for repository facts, likely file locations, existing implementations, current contracts, and candidate files before the planner inspects source files directly and does its own reasoning.
- Post-edit searches confirmed the old `100% confident` and `double check your thoughts` authority wording was removed from both `kadshow` variants; no `double-check your thoughts`, `come up with suggestions`, or `ensure all edge cases` phrasing existed in this smaller family to rewrite, and the remaining `code_info` mentions are operational retrieval instructions.
- Ran the required per-file JSON parse checks and got clean results for both `kadshow` variants: `lmstudio_ok` and `vllm_ok`.
- Recorded the Manual Playwright expectation for later story validation: zero `[DEV-0000044][T6]` browser-console entries and zero browser `error` entries caused by Task 6, because this task changes command-template JSON text only.
- `npm run format:check --workspaces` passed cleanly; `npm run lint --workspaces` completed with the same existing repo-wide import-order warnings outside Task 6 and did not surface any Task 6-specific failures.

---

### 7. Research Prompt Retrieval Boundary Review

- Task Status: `__done__`
- Git Commits: `none yet`

#### Overview

Review the research-agent prompt and only change it if the file still implies that `code_info` decides the final answer rather than acting as one repository-evidence source. This task stays isolated because the research prompt has a different job from the planning and tasking prompts and current repository evidence suggests it may already be sufficiently retrieval-first.

#### Documentation Locations

- OpenAI function calling guide, for keeping tool instructions concise while preserving the model’s own reasoning responsibility: https://platform.openai.com/docs/guides/function-calling
- OpenAI tools and MCP guide, for how tools should support research without replacing reasoning: https://platform.openai.com/docs/guides/tools-connectors-mcp
- Context7 API Guide: https://context7.com/docs/api-guide, because it documents library search, context retrieval, version pinning, and error handling for the Context7 MCP-backed documentation workflow that this prompt names.
- DeepWiki documentation site: https://deepwiki.com, because this prompt explicitly names DeepWiki and the wording must keep its role as a repository research source rather than an authority.
- MUI MCP documentation index for Material UI 6.4.12: https://llms.mui.com/material-ui/6.4.12/llms.txt, because this prompt explicitly names the MUI MCP tool and the story must preserve that reference accurately without implying any MUI component work is required.
- Model Context Protocol tools concept and server behavior: https://modelcontextprotocol.io/docs/learn/server-concepts
- Writing clear instructions reference from GitHub Docs, for preserving a plain-text prompt’s readability while making minimal wording changes: https://docs.github.com/en/get-started/writing-on-github

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://platform.openai.com/docs/guides/function-calling`, `https://platform.openai.com/docs/guides/tools-connectors-mcp`, `https://context7.com/docs/api-guide`, `https://deepwiki.com`, `https://llms.mui.com/material-ui/6.4.12/llms.txt`, and `https://modelcontextprotocol.io/docs/learn/server-concepts` open while working. Current repo evidence says this file may already be acceptable, so record a no-change decision if the search terms below do not show authority-style wording.

1. [x] Read the documentation links above, then inspect [codex_agents/research_agent/system_prompt.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/research_agent/system_prompt.txt). Identify the exact sentence that talks about using `code_info`, DeepWiki, Context7, MUI, and web search, and confirm whether it already reads as broad research guidance rather than authority delegation. Junior copy/paste snippet for this subtask: `sed -n '1,80p' codex_agents/research_agent/system_prompt.txt`, `rg -n 'code_info|DeepWiki|Context7|MUI|web' codex_agents/research_agent/system_prompt.txt`.
2. [x] Only if the file still implies that `code_info` decides the answer, update [codex_agents/research_agent/system_prompt.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/research_agent/system_prompt.txt) so it still permits broad research across the codebase, libraries, and the web, while explicitly treating `code_info` as a repository-evidence tool rather than the authority that decides the answer. Reuse the same stable phrase set from Task 1 and `AGENTS.md` where it fits, and keep the rest of the research-agent prompt structure and scope intact. If no edit is needed, record that decision in Implementation notes instead of forcing prompt churn.
3. [x] Search the file for `code_info`, `100% confident`, `double check`, `come up with suggestions`, `judge whether`, and `confirm correctness`, plus any wording that could still imply the tool decides the answer. Record in Implementation notes whether the file was left unchanged or edited, which search terms were used, and why that choice matched the actual file contents.
4. [x] Manual Playwright-MCP log contract for Task 7. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T7]` and zero browser `error` entries caused by this story, because Task 7 only reviews or lightly edits prompt text. Do not add any new client/runtime log line such as `[DEV-0000044][T7] event=research_prompt_boundary_checked result=success`. Record this expected zero-match outcome in Implementation notes.
5. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using repository wrapper commands.
No wrapper build or automated test run is required for this task because it changes prompt text only. Validation for this task is the targeted wording search and file review completed in the subtasks above. Full wrapper regression is deferred to the final story task.

#### Implementation notes

- Set Task 7 to `__in_progress__`, inspected `codex_agents/research_agent/system_prompt.txt`, and confirmed the current `code_info` sentence reads as broad research workflow guidance rather than tool-authority wording.
- Left `codex_agents/research_agent/system_prompt.txt` unchanged because the file tells the research agent to use `code_info`, DeepWiki, Context7, MUI, and web search to investigate, not to let `code_info` decide the answer.
- Searched the file for `code_info`, `100% confident`, `double check`, `come up with suggestions`, `judge whether`, and `confirm correctness`; only the operational `code_info` research sentence matched, which supports the no-change decision.
- Recorded the Manual Playwright expectation for later story validation: zero `[DEV-0000044][T7]` browser-console entries and zero browser `error` entries caused by Task 7, because this task only reviews prompt text.
- `npm run format:check --workspaces` passed cleanly; `npm run lint --workspaces` completed with the same existing repo-wide import-order warnings outside Task 7 and did not surface any Task 7-specific failures.

---

### 8. Tasking Command Retrieval Boundary

- Task Status: `__to_do__`
- Git Commits: `none yet`

#### Overview

Update the tasking command template so `code_info` is described as a source of existing code, contracts, and evidence while responsibility for deciding the task breakdown stays with the tasking agent. This task is separate because `task_up.json` contains tasking-specific wording and explicit conversation-id instructions that must be preserved.

#### Documentation Locations

- OpenAI function calling guide, for concise instructions that keep the tool focused on retrieval and the agent focused on decision-making: https://platform.openai.com/docs/guides/function-calling
- OpenAI tools and MCP guide, for how tool metadata and instructions should support, not replace, model reasoning: https://platform.openai.com/docs/guides/tools-connectors-mcp
- Context7 API Guide: https://context7.com/docs/api-guide, because it documents library search, context retrieval, version pinning, and error handling for the Context7 MCP-backed documentation workflow that `task_up.json` names.
- DeepWiki documentation site: https://deepwiki.com, because `task_up.json` explicitly names DeepWiki and the wording must keep its role as a repository research source rather than an authority.
- MUI MCP documentation index for Material UI 6.4.12: https://llms.mui.com/material-ui/6.4.12/llms.txt, because `task_up.json` explicitly names the MUI MCP tool and the wording must preserve that reference accurately without introducing MUI implementation scope.
- JSON RFC overview, because this task edits JSON string content and must preserve valid JSON syntax and escaping: https://www.rfc-editor.org/rfc/rfc8259
- Model Context Protocol tools concept and server behavior: https://modelcontextprotocol.io/docs/learn/server-concepts

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://platform.openai.com/docs/guides/function-calling`, `https://platform.openai.com/docs/guides/tools-connectors-mcp`, `https://context7.com/docs/api-guide`, `https://deepwiki.com`, `https://llms.mui.com/material-ui/6.4.12/llms.txt`, and `https://www.rfc-editor.org/rfc/rfc8259` open while working. `task_up.json` is the main edit target, while `tasking_agent/system_prompt.txt` is expected to remain unchanged unless the searches prove otherwise.

1. [ ] Read the documentation links above, then inspect [codex_agents/tasking_agent/commands/task_up.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/tasking_agent/commands/task_up.json) and [codex_agents/tasking_agent/system_prompt.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/tasking_agent/system_prompt.txt). Confirm which `task_up.json` entries currently ask `code_info` to decide correctness, edge-case coverage, or missing logic, including the duplicated `Check if all the changes needed to implement this new logic are correctly documented...` entries and the `check if any of the logic planned to be implemented already exists` entry. Confirm separately that the system prompt’s conversation-id rule is operational-only. Junior copy/paste snippet for this subtask: `sed -n '1,180p' codex_agents/tasking_agent/commands/task_up.json`, `sed -n '1,60p' codex_agents/tasking_agent/system_prompt.txt`, `rg -n 'code_info|check if all the changes needed|check if any of the logic planned|ensure all edge cases' codex_agents/tasking_agent/commands/task_up.json codex_agents/tasking_agent/system_prompt.txt`.
2. [ ] Update every affected copy inside [codex_agents/tasking_agent/commands/task_up.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/tasking_agent/commands/task_up.json) so `code_info` is used to find existing code, existing contracts, reusable implementations, and repository evidence. Reuse the same stable phrase set from Task 1 and the updated `AGENTS.md` wording where it fits. Keep responsibility for deciding what to change, what to reuse, whether assumptions are valid, whether the plan has gaps, and how to break down the work with the tasking agent itself.
3. [ ] Re-read [codex_agents/tasking_agent/system_prompt.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/tasking_agent/system_prompt.txt) after the `task_up.json` edit. If it still only contains operational conversation-id guidance, leave it unchanged and record that decision in Implementation notes. Only edit it if it directly assigns reasoning or correctness decisions to `code_info`.
4. [ ] Search `task_up.json` and `tasking_agent/system_prompt.txt` for `code_info`, `100% confident`, `double check`, `double-check`, `check if all the changes needed`, `check if any of the logic planned`, `ensure all edge cases`, `judge whether`, `confirm correctness`, and `decide what to change`. Record which wording changed, which search terms returned no matches, and which operational wording intentionally stayed.
5. [ ] Specific file validation needed before wrapper testing. Confirm [codex_agents/tasking_agent/commands/task_up.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/tasking_agent/commands/task_up.json) still parses as JSON after the wording edit by running `node -e "JSON.parse(require('fs').readFileSync('codex_agents/tasking_agent/commands/task_up.json', 'utf8'));"`. Record the clean parse result in Implementation notes so a quote or escape regression cannot break tasking-command loading.
6. [ ] Manual Playwright-MCP log contract for Task 8. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T8]` and zero browser `error` entries caused by this story, because Task 8 only changes tasking command text and does not touch the browser runtime. Do not add any new client/runtime log line such as `[DEV-0000044][T8] event=tasking_command_boundary_aligned result=success`. Record this expected zero-match outcome in Implementation notes.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using repository wrapper commands.
No wrapper build or automated test run is required for this task because it changes command-template text only. Validation for this task is the wording search, operational-wording review, and JSON parse check completed in the subtasks above. Full wrapper regression is deferred to the final story task.

#### Implementation notes

- Pending.

---

### 9. Final Story Closeout

- Task Status: `__to_do__`
- Git Commits: `none yet`

#### Overview

Perform the final whole-story validation. This task proves the server description regression still passes, confirms the wording boundary is consistent across all updated surfaces, checks whether any additional file discovered during implementation also needed updating, and records any documentation files that were intentionally left unchanged.

#### Documentation Locations

- npm run-script command reference, because all validation must be run through repository wrapper scripts: https://docs.npmjs.com/cli/v10/commands/npm-run-script
- Node.js `node:test` API, because the server regression assertion added in this story runs through the full server unit wrapper: https://nodejs.org/docs/latest-v22.x/api/test.html
- Context7 Jest library reference: https://context7.com/jestjs/jest, because this task runs the client Jest wrapper and any client-test diagnosis in this task should use the Jest documentation surfaced through the Context7 workflow the repository expects for non-MUI libraries.
- Context7 Mermaid reference: https://context7.com/mermaid-js/mermaid, because if this final task discovers architecture or flow drift that must be documented, any Mermaid diagram added to `design.md` needs to match the Mermaid specification.
- Cucumber guides index: https://cucumber.io/docs/guides/, because this task runs the repository cucumber wrapper and the story should point implementers at the official Cucumber guides hub before any deeper wrapper-level diagnosis.
- Cucumber Continuous Integration guide, because it explicitly recommends running Cucumber from the build or CI entrypoint instead of ad hoc commands, which matches this repository’s wrapper-first test policy: https://cucumber.io/docs/guides/continuous-integration/
- Playwright intro docs, only if later implementation adds a GUI-touching change that must be checked manually; otherwise record that Playwright is not applicable to this non-GUI story: https://playwright.dev/docs/intro
- Markdown Guide basic syntax reference, because this task may need to update final summary text inside the story plan itself: https://www.markdownguide.org/basic-syntax/

#### Subtasks

Self-contained reminder for every subtask in this task: keep `https://docs.npmjs.com/cli/v10/commands/npm-run-script`, `https://nodejs.org/docs/latest-v22.x/api/test.html`, `https://context7.com/jestjs/jest`, `https://cucumber.io/docs/guides/`, and `https://context7.com/mermaid-js/mermaid` open while working. This final task is the cross-story safety net, so each subtask should explicitly record why a file stayed unchanged or what was updated.

1. [ ] Re-read every file changed by Tasks 1 to 8 and confirm the wording contract is consistent across the server tool description, repo guidance, helper text, system prompts, and command templates. Use repository searches for `come up with suggestions`, `100% confident`, `to be 100% confident of the answer`, `double check your thoughts`, `double-check your thoughts`, `ensure all edge cases are covered`, `check if all the changes needed`, `check if any of the logic planned`, `judge whether`, `be certain`, `confirm correctness`, `determine the approach`, `decide what to change`, `code_info`, and `codebase_question`. In the same review pass, confirm the stable retrieval-first phrase set or a clearly equivalent lighter rewrite still appears across the core layers: `repository facts`, `likely file locations`, `summaries of existing implementations`, `current contracts`, `inspect source files directly`, and `do its own reasoning`. Record which files still mention `code_info` or `codebase_question` and why any remaining mentions are acceptable. Junior copy/paste snippet for this subtask: `rg -n 'come up with suggestions|100% confident|double check your thoughts|double-check your thoughts|ensure all edge cases are covered|check if all the changes needed|check if any of the logic planned|judge whether|be certain|confirm correctness|determine the approach|decide what to change|code_info|codebase_question|repository facts|likely file locations|summaries of existing implementations|current contracts|inspect source files directly|do its own reasoning' AGENTS.md docs/developer-reference.md usefulCommands.txt.md codex_agents server/src/mcp2/tools/codebaseQuestion.ts`.
2. [ ] Search the wider repository for additional prompt or helper files that mention `code_info` or `codebase_question` as if they are reasoning authorities. At minimum re-check [codex_agents/tasking_agent/system_prompt.txt](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/tasking_agent/system_prompt.txt) and [usefulCommands.txt.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/usefulCommands.txt.md). `codex_agents/coding_agent/system_prompt.txt` and [codex_agents/tasking_agent/commands/smoke.json](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/codex_agents/tasking_agent/commands/smoke.json) were already verified during planning to contain no repository-question guidance, so they do not need to be re-opened unless implementation adds new references there. If a newly found file truly violates the story boundary, update it in this task; otherwise record why it was intentionally left unchanged.
3. [ ] Perform an explicit acceptance-criteria checklist pass against the finished implementation. Record in Implementation notes where each of the following was confirmed: retrieval-only wording in the MCP tool description, the inspect-and-reason requirement, aligned wording across `AGENTS.md` and the `codex_agents` surfaces, removal or rewrite of legacy certainty phrases, the lightweight regression check location, unchanged public MCP method name, unchanged REST/MCP request-response shapes, unchanged runtime/storage behavior, unchanged legacy identifiers such as `CODE_INFO_LLM_UNAVAILABLE`, and confirmation that no investigation subtasks or open implementation questions remain.
4. [ ] Document review: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md). Description and purpose: confirm the repository readme does not need wording changes for this story, or update it if the finished wording work unexpectedly changes how repository-question tooling is described to general readers. Record the explicit keep-as-is or updated decision in Implementation notes.
5. [ ] Document review: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Description and purpose: confirm `design.md` does not need architecture or flow changes because no runtime behavior changed, or if an earlier task unexpectedly did change architecture or add a flow, update `design.md` in this task with the required explanatory text and Mermaid diagrams using the Context7 Mermaid reference listed above. Record the explicit keep-as-is or updated decision in Implementation notes.
6. [ ] Document review: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Description and purpose: confirm the repository file-map document does not need changes unless tracked files were added or removed during implementation, or update it if the final implemented scope changed the tracked file tree. Any such update must include every tracked file added or removed across the story, not just a partial list. Record the explicit keep-as-is or updated decision in Implementation notes.
7. [ ] Scope confirmation outside markdown docs. Description and purpose: confirm no `client/`, MUI, compose, websocket, REST, or Mongo-facing files needed changes as part of this story and record that keep-as-is decision in Implementation notes so the final closeout does not leave those boundaries implicit.
8. [ ] Add a concise final story summary in this plan’s Implementation notes describing which file groups were updated, which phrases were removed, where the regression check lives, and any intentionally unchanged files that were reviewed.
9. [ ] Manual Playwright-MCP log contract for Task 9. Expected browser-console outcome later: zero matches for the prefix `[DEV-0000044][T9]` and zero browser `error` entries caused by this story, because final closeout does not add browser/runtime behavior. Do not add any new client/runtime log line such as `[DEV-0000044][T9] event=story_closeout_verified result=success`. Record this expected zero-match outcome in Implementation notes so the final Playwright check has an explicit failure rule if any Story 44 browser marker appears.
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Wrapper-only policy: do not attempt to run builds or tests without using the wrapper commands listed below.
Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts. This preserves tokens while keeping full diagnostics available.

1. [ ] `npm run build:summary:server` - Use because server/common code is affected and this is the final regression check. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [ ] `npm run build:summary:client` - Use because this is the final regression check and the repository is validated at the app level even though no client runtime files are expected to change. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [ ] `npm run test:summary:server:unit` - Use for server `node:test` unit/integration coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [ ] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [ ] `npm run test:summary:client` - Use because this is the final regression check and repository-wide text/config changes should still leave the full client wrapper green. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [ ] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - Use because this is the final regression check and the plan must validate the full wrapper-driven app flow once after all story changes are complete. If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [ ] `npm run compose:build:summary` - Use because this is the final regression check. If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [ ] `npm run compose:up`
9. [ ] Manual Playwright-MCP check to confirm the front end still loads at `http://host.docker.internal:5001`, the app shell renders without breaking after the story changes, and the browser debug console shows no logged errors during the regression pass. Capture at least one screenshot of the loaded app shell and any GUI surface touched during the smoke pass, save the files under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` using Story 44-specific names such as `0000044-final-regression-home.png`, and review the saved images directly to confirm there is no blank screen, broken layout, obvious visual regression, or unexpected error state. That folder is mapped within `docker-compose.local.yml`, so do not save screenshots anywhere else. Expected console-log outcome: zero matches for `[DEV-0000044][T1]`, `[DEV-0000044][T2]`, `[DEV-0000044][T3]`, `[DEV-0000044][T4]`, `[DEV-0000044][T5]`, `[DEV-0000044][T6]`, `[DEV-0000044][T7]`, `[DEV-0000044][T8]`, and `[DEV-0000044][T9]`, because Story 44 is guidance-only and must not introduce browser/runtime markers. If any of those prefixes appear, or any console entry has type `error`, fail the manual check and treat it as scope drift or a regression.
10. [ ] `npm run compose:down`

#### Implementation notes

- Pending.
