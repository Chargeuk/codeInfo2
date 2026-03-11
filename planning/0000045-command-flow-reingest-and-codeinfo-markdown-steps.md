# Story 0000045 – Command And Flow Reingest And Codeinfo Markdown Steps

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Command JSON files and flow JSON files already let users automate multi-step agent work, but two important workflow needs are still missing.

The first missing need is repository re-ingest as part of a workflow. Users can manually re-ingest a repository today, but they cannot place that action inside a command or flow and guarantee that the next workflow step will wait until re-ingest has actually finished. This makes it awkward to build update-and-research workflows because the next AI step may run before the repository search index is ready.

The second missing need is reusable long-form markdown input. Current command and flow `llm`-style steps are built around message arrays, which is fine for short prompts but awkward for large, curated instructions. Users want to place markdown files into a predictable repository folder and reference them from commands and flows without the system trimming, rewriting, or otherwise reformatting the markdown before it is passed to the AI agent.

This story adds both capabilities, but keeps them within the existing synchronous runner model. It does not introduce paused execution or user-interactive waiting. Each new step must run to a terminal outcome before the runner decides what to do next.

For commands, this story keeps the existing top-level `Description + items[]` file shape for backward compatibility. To keep the implementation simple, the existing command `message` item continues to be the command-side LLM step. This story does not add a second command item type that means "run an LLM step". Instead, it adds one new command item type for re-ingest and extends the existing `message` item so it can load its instruction from either `content` or `markdownFile`.

For markdown files, the user has chosen a repository-level folder named `codeinfo_markdown`, similar to repository `flows` support. Markdown files must be resolved using deterministic repository priority rules instead of ad hoc relative paths:

- same source repository as the running flow or a command executed from inside that flow;
- then the codeInfo2 repository;
- then other ingested repositories sorted by case-insensitive source label and then case-insensitive full source path.

Current repository evidence shows that direct command entrypoints in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) already accept an optional repository `sourceId` for loading command files from ingested repositories. Story 45 should reuse that existing upstream input instead of discarding it. That means direct commands launched with an ingested-repository `sourceId` should resolve `markdownFile` using the same deterministic repository ordering as flows: same-source first, then codeInfo2, then other ingested repositories. Direct commands launched without a repository `sourceId` still fall back to the local codeInfo2 checkout, where same-source and codeInfo2 collapse to the same root.

Within `codeinfo_markdown`, this story supports safe relative subpaths such as `architecture/auth/login.md`. Absolute paths, `..` traversal, and any lookup that escapes the resolved `codeinfo_markdown` root remain forbidden.

For re-ingest steps, the story reuses the server’s existing blocking re-ingest behavior. The step must wait until ingest finishes with a terminal status such as completed, cancelled, or error before the runner may continue. If re-ingest fails, the command or flow still continues to the next step, but the step result must be recorded in a structured way so users and later debugging can see exactly what happened.

This story deliberately excludes user-input waiting. That will be handled in a later story because it requires a new paused/resumable run state rather than a normal synchronous step.

### Concrete Contracts

The following concrete contracts define the intended output of this story. They are here so a junior developer can see the target shapes and behaviors before any tasking is created.

#### Command File Contract

Command files keep the current top-level shape:

```json
{
  "Description": "Refresh the repository index and run the review prompt.",
  "items": [
    {
      "type": "reingest",
      "sourceId": "/workspace/repository"
    },
    {
      "type": "message",
      "role": "user",
      "markdownFile": "architecture/review.md"
    },
    {
      "type": "message",
      "role": "user",
      "content": ["Summarize the main risks in three bullets."]
    }
  ]
}
```

Rules for command items:

- `Description` keeps its existing capital `D` field name.
- `items` stays the executable array. This story does not rename it to `steps`.
- `message` remains the existing command LLM item shape.
- A `message` item must contain exactly one instruction source:
  - `content: string[]`; or
  - `markdownFile: string`.
- A `message` item must never contain both `content` and `markdownFile`.
- `role` remains fixed to `user` for command `message` items.
- A new `reingest` item is added with the shape `{ "type": "reingest", "sourceId": "<absolute-ingested-root>" }`.

#### Flow File Contract

Flow files keep the current top-level shape:

```json
{
  "description": "Refresh the repository index and run the review prompt.",
  "steps": [
    {
      "type": "reingest",
      "label": "Refresh repository index",
      "sourceId": "/workspace/repository"
    },
    {
      "type": "llm",
      "label": "Architecture review",
      "agentType": "planning_agent",
      "identifier": "architecture-review",
      "markdownFile": "architecture/review.md"
    }
  ]
}
```

Rules for flow steps:

- Existing `llm`, `command`, `break`, and `startLoop` shapes stay valid unless this story explicitly extends them.
- A flow `llm` step must contain exactly one instruction source:
  - `messages: FlowMessage[]`; or
  - `markdownFile: string`.
- A flow `llm` step must never contain both `messages` and `markdownFile`.
- A new `reingest` flow step is added with the shape `{ "type": "reingest", "sourceId": "<absolute-ingested-root>", "label"?: string }`.

#### Markdown Resolution Contract

`markdownFile` is always a path relative to a repository-level `codeinfo_markdown` folder. The resolver behavior is:

1. Validate the requested path.
2. Reject empty values, absolute paths, `..` traversal, and any normalized path that would escape `codeinfo_markdown`.
3. Build candidate repositories in this order:
   - same source repository as the running flow or a command executed from inside that flow;
   - the codeInfo2 repository;
   - other ingested repositories sorted case-insensitively by source label and then by full source path.
4. For each candidate, look for `<candidate-root>/codeinfo_markdown/<markdownFile>`.
5. If the file is missing in that candidate, move to the next candidate.
6. If the file exists but cannot be read, is invalid UTF-8, or fails path validation for that candidate, fail the step immediately instead of silently falling through to another repository.
7. If no candidate contains the file, fail the step with a clear markdown-file-not-found error instead of silently producing an empty instruction.
8. Use the first successfully read file and pass its bytes through as UTF-8 text exactly as read.

For direct command execution, the existing command `sourceId` input defines same-source repository context when it is present. If no direct-command `sourceId` is present, the local codeInfo2 checkout is treated as the only same-source root. For flow-owned command execution, the same-source and codeInfo2 roots may collapse to the same checkout when the flow itself is running from codeInfo2.

#### Re-Ingest Step Result Contract

The re-ingest step uses the same `sourceId` contract as the existing blocking re-ingest service: it is the exact absolute repository root path of an already ingested repository, not a display label and not a relative path.

Once a re-ingest step starts, it must always finish with a structured terminal result that includes at least:

```json
{
  "stepType": "reingest",
  "sourceId": "/workspace/repository",
  "status": "completed",
  "runId": "ingest-run-id",
  "errorCode": null
}
```

The exact storage location can follow the existing command/flow run result patterns, but the information above must be recorded in a structured form for later inspection. Terminal statuses of `completed`, `cancelled`, and `error` are non-fatal to the overall command or flow once the step has started. By contrast, invalid step configuration should still fail validation before the run starts.

This story distinguishes between a re-ingest step that never starts and one that starts but reaches a non-happy terminal outcome. Validation failures, unknown `sourceId` values, busy/locked ingest state, and other service rejections that happen before a terminal re-ingest payload exists fail the current command or flow step immediately. The non-fatal continuation rule applies only after the blocking re-ingest call has been accepted and a structured terminal result can be recorded.

The existing blocking re-ingest service already collapses ingest status `skipped` into terminal step status `completed`. This story keeps that behavior instead of introducing a fourth public terminal step status.

`markdownFile` content is always treated as one user instruction string after the file is read. The system does not parse markdown into multiple chat messages, frontmatter fields, or a richer prompt DSL as part of this story.

### Research Findings And Scope Guardrails

The following points come from direct inspection of the current repository plus external documentation research. They narrow the story to the smallest implementation that fits the existing code.

- The repository currently uses `zod` `3.25.76`. The package does not expose `z.xor`, so XOR validation in this story should be implemented with explicit object unions or `superRefine`, not by depending on a newer upstream API.
- `server/src/agents/commandsRunner.ts` currently retries every command item through `runWithRetry(...)`. Re-ingest steps should be excluded from retry injection and retried AI prompts. They should execute once, record their terminal result, and then continue or fail validation according to the normal step contract.
- `server/src/flows/service.ts` currently executes flow `llm` steps by iterating `step.messages`. The markdown-file branch therefore needs to resolve to a single instruction string executed once, not to an array of derived messages.
- Node.js string decoding does not guarantee that invalid UTF-8 bytes will throw during normal `'utf8'` reads. If this story promises that invalid UTF-8 markdown fails clearly, the implementation must read raw bytes and decode them with strict UTF-8 error handling instead of relying on permissive string conversion.
- Flow repository ordering already exists in the codebase and is deterministic. This story should reuse that ordering logic rather than inventing a second repository-priority implementation for markdown loading.
- Direct command entrypoints already accept an optional repository `sourceId` in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts). Story 45 should reuse that existing upstream context for markdown resolution instead of forcing direct commands back to codeInfo2-only behavior.
- Flow command metadata is already stored with optional schema fields in [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts), but the current TypeScript flow-command metadata builder in [flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) still assumes `agentType` and `identifier` always exist. Dedicated flow `reingest` steps must update that runtime typing so step metadata can persist safely without fake agent values.

### Runtime Message And Storage Contracts

This story does not need new top-level websocket event types, a new websocket protocol version, a new Mongo collection, or a new top-level conversation storage object. The current repository already has reusable structures for command metadata, mixed tool-call payloads, timing metadata, and conversation flags.

Contracts that remain unchanged:

- `server/src/mongo/turn.ts`
  - `Turn.status` stays `ok | stopped | failed`.
  - `Turn.command` remains the existing command/flow metadata object.
  - Flow command metadata for non-agent steps such as dedicated `reingest` may omit `agentType` and `identifier`, but must still keep `name`, `stepIndex`, `totalSteps`, `loopDepth`, and `label` so step metadata remains usable in websocket snapshots and persisted turns.
  - `Turn.toolCalls` remains the existing mixed payload slot for structured tool-style data.
  - `Turn.timing` remains the place for elapsed blocking duration when it is useful to persist it.
- `server/src/mongo/conversation.ts`
  - `Conversation.flags` remains the existing mixed object.
  - Story 45 does not add a new top-level `flags` key because the story stays synchronous and does not introduce paused/resumable state.
- `server/src/ws/types.ts`
  - `tool_event`, `inflight_snapshot`, `turn_final`, `ingest_snapshot`, and `ingest_update` remain the websocket surfaces used by this story.
  - Story 45 does not add a new websocket event type just for re-ingest or markdown-backed steps.

The one runtime contract that should be defined up front is the structured re-ingest result payload carried inside the existing tool-event / toolCalls shape.

For re-ingest steps, emit and persist a `tool-result` style payload using the existing event/storage path. The nested `result` payload should contain:

```json
{
  "kind": "reingest_step_result",
  "stepType": "reingest",
  "sourceId": "/workspace/repository",
  "status": "completed",
  "operation": "reembed",
  "runId": "ingest-123",
  "files": 10,
  "chunks": 42,
  "embedded": 42,
  "errorCode": null
}
```

The live websocket / inflight wrapper should reuse the existing tool-event shape:

```json
{
  "type": "tool-result",
  "callId": "reingest-step-1",
  "name": "reingest_repository",
  "stage": "success",
  "result": {
    "kind": "reingest_step_result",
    "stepType": "reingest",
    "sourceId": "/workspace/repository",
    "status": "completed",
    "operation": "reembed",
    "runId": "ingest-123",
    "files": 10,
    "chunks": 42,
    "embedded": 42,
    "errorCode": null
  },
  "errorTrimmed": null,
  "errorFull": null
}
```

The persisted turn-storage wrapper should reuse the existing `Turn.toolCalls` container shape:

```json
{
  "calls": [
    {
      "type": "tool-result",
      "callId": "reingest-step-1",
      "name": "reingest_repository",
      "stage": "success",
      "result": {
        "kind": "reingest_step_result",
        "stepType": "reingest",
        "sourceId": "/workspace/repository",
        "status": "completed",
        "operation": "reembed",
        "runId": "ingest-123",
        "files": 10,
        "chunks": 42,
        "embedded": 42,
        "errorCode": null
      },
      "error": null
    }
  ]
}
```

These payloads should travel through the existing shapes rather than a new bespoke one:

- live websocket publication via the existing `tool_event` event shape;
- inflight snapshots via the existing `inflight_snapshot.inflight.toolEvents` shape;
- persisted turn storage via the existing `Turn.toolCalls` field, using the same general `{ calls: [...] }` container already used for tool results.
- every emitted or persisted re-ingest `tool-result` includes a `callId` because the current runtime `ToolEvent` and persisted tool-call shapes already require it. The implementation may synthesize that `callId` for workflow-owned re-ingest steps, but it must stay unique within the assistant turn and stable across the live event and persisted copy of the same result.

Status rules for these existing outer shapes:

- The nested re-ingest payload keeps the terminal re-ingest status `completed | cancelled | error`.
- The outer tool-event wrapper uses:
  - `name: "reingest_repository"` for every re-ingest step result;
  - `stage: "success"` when the nested re-ingest status is `completed`;
  - `stage: "error"` when the nested re-ingest status is `cancelled` or `error`.
- The outer `Turn.status` and outer `turn_final.status` continue to use the existing run-level enum `ok | stopped | failed`.
- A non-fatal re-ingest terminal result therefore does not require a new outer status value. If the overall command or flow continues, the outer run-level status remains on the existing path and the detailed re-ingest outcome lives inside the nested structured payload.
- When a re-ingest step reaches a terminal result and the overall command or flow is still continuing normally, any persisted step turn and any `turn_final` event for that step stay on the existing success path (`ok`) and rely on the nested structured payload for the detailed `completed | cancelled | error` outcome.

Markdown-backed steps do not require a new persisted storage shape. They reuse the existing instruction/turn pipeline, with the loaded markdown becoming the instruction string that is executed, streamed, and persisted through the normal turn content and command metadata paths. Story 45 does not add a separate `markdownSource`, `markdownFileContents`, or similar persisted field beyond that normal execution path.

### Acceptance Criteria

- Command JSON keeps the existing top-level shape `{ "Description": string, "items": [...] }`. This story does not replace command files with a top-level `steps` array.
- Command JSON adds exactly one new executable item type for this story: `{ "type": "reingest", "sourceId": "<absolute-ingested-root>" }`.
- Command JSON keeps the existing `message` item for LLM execution and extends that item so it accepts exactly one instruction source:
  - `content: string[]`; or
  - `markdownFile: string`.
- A command `message` item that provides both `content` and `markdownFile`, or neither of them, fails schema validation.
- Flow JSON keeps the existing top-level shape `{ "description"?: string, "steps": [...] }`.
- Flow JSON adds exactly one new executable step type for this story: `{ "type": "reingest", "sourceId": "<absolute-ingested-root>", "label"?: string }`.
- Flow JSON keeps the existing `llm` step shape and extends it so it accepts exactly one instruction source:
  - `messages: FlowMessage[]`; or
  - `markdownFile: string`.
- A flow `llm` step that provides both `messages` and `markdownFile`, or neither of them, fails schema validation.
- The `sourceId` field used by re-ingest steps means the exact absolute root path of an already ingested repository, matching the current blocking re-ingest service contract.
- When a command or flow reaches a re-ingest step, the runner does not start the next step until the blocking re-ingest call has reached one of the terminal statuses `completed`, `cancelled`, or `error`.
- Once a re-ingest step has started successfully, any of the terminal statuses `completed`, `cancelled`, or `error` is recorded as a structured step result and does not stop the rest of the command or flow from continuing.
- The structured re-ingest result records at least the step type, sourceId, terminal status, ingest run id, and any available error code.
- Re-ingest step execution is single-attempt. It does not participate in AI retry prompt injection and does not automatically trigger a second re-ingest run after a terminal result.
- Story 45 does not add a new top-level websocket event type, a new websocket protocol version, or a new Mongo collection for workflow step results.
- Story 45 does not add a new top-level conversation `flags` key for these synchronous steps.
- Re-ingest step results are carried inside the existing tool-event and `Turn.toolCalls` paths as structured nested data rather than through a bespoke top-level message contract.
- Existing outer run-level statuses remain unchanged:
  - `Turn.status` stays `ok | stopped | failed`;
  - websocket `turn_final.status` stays `ok | stopped | failed`;
  - detailed re-ingest terminal outcomes stay inside the nested structured re-ingest result payload.
- Markdown file contents are read from UTF-8 files and passed to the AI agent verbatim, with no trimming, newline rewriting, whitespace cleanup, or prompt reformatting.
- Invalid UTF-8 markdown bytes fail with a clear step error rather than being silently replaced or normalized.
- `markdownFile` values are always resolved under a repository-level `codeinfo_markdown` directory and may include safe relative subpaths such as `architecture/auth/login.md`.
- Absolute paths, empty paths, `..` traversal, and any normalized path that would escape `codeinfo_markdown` fail validation with a clear step error.
- Markdown resolution order for repository-scoped execution is deterministic:
  - same source repository first;
  - codeInfo2 repository second;
  - other ingested repositories last, sorted case-insensitively by source label and then by full source path.
- Direct command execution reuses the existing command `sourceId` input when it is present, so same-source markdown lookup works for commands started from ingested repositories without adding a new API surface. Direct commands with no repository `sourceId` still fall back to codeInfo2-only lookup.
- When a command is executed as a flow command step, markdown resolution inside that command uses the parent flow's repository ordering and same-source repository context.
- If the requested markdown file is missing in the same-source repository, the resolver falls back to codeInfo2 and then to the sorted list of other repositories.
- If a candidate repository contains the requested markdown file but the file cannot be read successfully, the step fails immediately instead of silently falling through to a lower-priority repository.
- Local-only command execution resolves `codeinfo_markdown` from the codeInfo2 repository and does not invent a separate same-source repository.
- Existing command `message` behavior using `content: string[]` continues to work unchanged when `markdownFile` is not used.
- Existing flow `llm` behavior using `messages: FlowMessage[]` continues to work unchanged when `markdownFile` is not used.
- `markdownFile` content is executed as one user instruction string. This story does not expand a markdown file into multiple user messages or additional prompt structure.
- This story does not add paused execution, resumable workflow state, or user-input waiting.

### Edge Cases And Failure Modes

- Schema XOR failures: a command `message` item or flow `llm` step that provides both instruction sources, or neither instruction source, fails schema validation before any run begins.
- Unsafe markdown paths: empty paths, absolute paths, `..` traversal, or any normalized path that escapes `codeinfo_markdown` fail immediately with a clear validation error.
- Markdown missing everywhere: when the requested `markdownFile` does not exist in any candidate repository, the step fails with a clear not-found error. The runner must never substitute an empty string or silently skip the step.
- Candidate exists but cannot be used: if a higher-priority repository contains the target file but the file cannot be read or decoded as strict UTF-8, the step fails immediately. The resolver must not fall through to a lower-priority repository in that case because that would hide a broken same-name file.
- Deterministic duplicate names: if multiple repositories have the same `sourceLabel` or the same markdown file path, the resolver must still choose deterministically using the existing case-insensitive label-then-path ordering already used by flow repository resolution.
- Direct command repository scope: direct commands launched with the existing `sourceId` input must use that repository as same-source markdown context before falling back to codeInfo2 and other repositories. Direct commands launched without `sourceId` still resolve from codeInfo2 only because there is no upstream repository context to prefer.
- Flow-owned command parity: commands executed inside a flow must reuse the parent flow repository context and produce the same markdown and re-ingest behavior as direct command execution. Story 45 must not leave separate per-item logic in `commandsRunner.ts` and flow command execution that can drift over time.
- Re-ingest never starts: invalid `sourceId`, repository not currently re-ingestable, busy/locked ingest state, unsupported arguments, or other service rejections before a re-ingest terminal payload exists fail the current step immediately. These are not non-fatal terminal re-ingest outcomes.
- Re-ingest reaches a terminal error-like outcome: timeout, missing run status after launch, unknown terminal state, explicit cancelled, or explicit error must be normalized into the structured re-ingest result payload, recorded through the existing tool-event and `Turn.toolCalls` paths, and then allow the command or flow to continue.
- Multiple re-ingest results in one run: if a command or flow produces more than one re-ingest result in the same assistant turn, each emitted and persisted `tool-result` must keep its own distinct `callId`. The implementation must not key these payloads only by tool name or later results will overwrite earlier ones.
- Cancellation during blocking re-ingest: current ingest waiting code does not accept an abort signal, so Story 45 should not promise mid-step interruption of the blocking wait. If cancellation is requested while a re-ingest step is waiting, the request is observed after the blocking call returns and before the next step starts.
- Unexpected thrown exceptions: if markdown resolution or the blocking re-ingest path throws an unexpected exception instead of returning a structured result, the outer command or flow should fail with a clear error because the runner cannot safely invent a trustworthy terminal step payload.
- Outer run status versus nested re-ingest status: a recorded re-ingest terminal result of `cancelled` or `error` should map to the nested tool-result payload and outer tool-event stage, but it must not by itself rewrite outer `Turn.status` or websocket `turn_final.status` away from the normal run-level contract when the workflow continues successfully.

### Out Of Scope

- Any step that waits for the user to type content during an active run.
- REST or websocket contracts for paused or resumable command/flow execution.
- A new websocket event family or websocket protocol version just for Story 45 step results.
- A new Mongo collection or standalone persisted document type just for re-ingest or markdown-backed step data.
- Accepting repository display labels or fuzzy repository names in re-ingest steps. This story uses exact ingested repository root `sourceId` values only.
- Adding a new direct-command REST or MCP contract just to support markdown lookup. Story 45 must reuse the existing optional command `sourceId` input that is already exposed in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts).
- Free-form filesystem-relative markdown lookup outside of `codeinfo_markdown`.
- Adding a second command-only LLM step type when the existing command `message` item already covers that responsibility.
- Expanding markdown files into multiple message objects, frontmatter-driven prompt behavior, or any other markdown prompt DSL.
- Automatic retries that start a second re-ingest run after a terminal re-ingest result.
- Replacing existing flow command-resolution behavior with a new global resolver order beyond the markdown resolution needed by this story.
- Adding new command or flow step types unrelated to re-ingest or markdown-backed `llm`.
- Changing agent instruction semantics outside of what is required to pass verbatim markdown content.

### Questions

None. The command-file compatibility and markdown-path decisions are now fixed for this story.

### Ground Rules For Juniors (Read Before Any Task)

- Run commands from the repository root `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2` unless a subtask explicitly says otherwise. Use `npm`, the wrapper scripts in [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md), and the existing workspaces instead of ad hoc raw commands.
- Before starting the first code-editing subtask in any task, read that task's `Documentation Locations`, then read the exact repo files named in the task's `Required Files For This Task` section. Do not rely on memory or on surrounding tasks.
- When a task says "create" a helper or test file, create the exact path named in that task unless the subtask explicitly says to reuse an existing file in place. If you choose a different path because the codebase forces it, update every later task in this story that references that helper in the same commit so the plan stays self-consistent for the next developer.
- After every code-editing subtask, run the smallest relevant verification command before moving on. If a wrapper or test command fails, stop, fix it, and rerun it before continuing. Do not batch unresolved failures until the end of the task.
- Every task that creates, deletes, or moves files must update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) before that task is marked complete. Record all added, removed, and replaced file paths, not just the main helper.
- Do not invent new APIs, websocket events, Mongo fields, or retry behavior when the story tells you to reuse an existing contract. Story 45 is intentionally narrow and prefers upstream reuse over new branches of logic.

## Implementation Ideas

### 1. Schema Surface And Parsing

The schema work should stay close to the existing file shapes instead of introducing a second migration.

- Update `server/src/agents/commandsSchema.ts` so command `items` become a discriminated union of:
  - existing `message` items, extended to allow exactly one of `content` or `markdownFile`;
  - new `reingest` items with `sourceId`.
- Update `server/src/flows/flowSchema.ts` so the flow step union gains:
  - existing `llm` steps, extended to allow exactly one of `messages` or `markdownFile`;
  - new `reingest` steps;
  - unchanged `command`, `break`, and `startLoop` steps.
- Keep the existing command top-level shape `{ Description, items }` and the existing flow top-level shape `{ description?, steps }`.
- Because the repository is on `zod` `3.25.76`, implement the XOR rules with explicit object unions and/or `superRefine` instead of relying on `z.xor`.
- Keep `server/src/agents/commandsLoader.ts` and flow file loading behavior simple: parsing should remain responsible for schema validation, while file-content resolution for `markdownFile` should happen at execution time.

### 2. Shared Markdown Resolver

This story needs one shared server-side helper for file lookup and decoding so direct commands, flow `llm` steps, and flow-invoked commands all behave the same way.

- Add one shared markdown resolver helper in the server codebase at `server/src/flows/markdownFileResolver.ts`, next to the existing flow repository-resolution logic.
- That helper should:
  - validate that `markdownFile` is a safe relative path under `codeinfo_markdown`;
  - reject empty paths, absolute paths, `..` traversal, and any normalized path that escapes the root;
  - build candidate repositories using the existing deterministic ordering already present in `server/src/flows/service.ts`;
  - continue on missing files only;
  - fail immediately once a candidate file exists but cannot be read or decoded;
  - read bytes and decode with strict UTF-8 handling so invalid bytes fail clearly;
  - return the exact file text without trimming, newline rewriting, or markdown-specific preprocessing.
- Repository context should be threaded into this helper only where that context already exists:
  - direct command runs reuse the existing command `sourceId` when it is present, otherwise they fall back to the local codeInfo2 checkout;
  - flow `llm` steps use the current flow repository context;
  - flow-invoked commands reuse the parent flow repository context.

### 3. Command Execution Path

Direct command execution already has the right outer structure in `server/src/agents/commandsRunner.ts`. The work here is mainly about branching per item type without breaking existing retry and stop behavior for AI instruction steps.

- Keep the current sequential `for` loop and existing step metadata (`stepIndex`, `totalSteps`, `command.name`) intact.
- For `message` items:
  - preserve the existing `content.join('\\n')` path for backward compatibility;
  - add a `markdownFile` branch that resolves one markdown file into one instruction string and then calls the existing `runAgentInstructionUnlocked(...)` path once.
- For `reingest` items:
  - bypass AI retry prompt injection and do not route through `runWithRetry`;
  - call `server/src/ingest/reingestService.ts` once with the declared `sourceId`;
  - record the terminal result in a structured way and then continue to the next command item.
- The runner signature will likely need one small extension so command execution can optionally receive repository context from flows without inventing a new REST/MCP surface for direct commands.

### 4. Flow Execution Path

The flow runner already has a step dispatcher in `server/src/flows/service.ts`, and that is the right place to keep step-type behavior explicit.

- Extend the flow execution loop so it recognizes the new `reingest` step type alongside `llm`, `break`, `command`, and `startLoop`.
- Extend `runLlmStep(...)` so the `markdownFile` branch resolves one markdown file into one instruction string and sends it once through the existing agent-turn execution path.
- Add a dedicated `runReingestStep(...)` helper that wraps the blocking re-ingest service and returns a non-fatal terminal outcome for `completed`, `cancelled`, or `error`.
- Keep the existing flow resume and loop bookkeeping unchanged. This story should add new step behavior, not new pause/resume machinery.

### 5. Shared Command-Item Execution Between Direct Commands And Flow Command Steps

Direct commands and flow command steps cannot drift here. Current repository evidence shows that flow command steps do not delegate to `runAgentCommandRunner(...)`; instead, `server/src/flows/service.ts` loads the command file and iterates `command.items` itself.

- Extract a shared command-item execution helper, or otherwise centralize the per-item behavior, so both of these call sites use the same logic:
  - `server/src/agents/commandsRunner.ts`;
  - flow command execution inside `server/src/flows/service.ts`.
- That shared behavior should cover:
  - `message.content` execution;
  - `message.markdownFile` execution;
  - `reingest` item execution;
  - repository-context-aware markdown resolution;
  - structured result recording for non-message items.
- Keeping this logic shared is important because Story 45 changes command items themselves, not just direct command execution.

### 6. Re-Ingest Result Recording

The implementation should reuse existing command/turn/flow result patterns before inventing a new persistence shape.

- Reuse `server/src/ingest/reingestService.ts` as the single source of truth for:
  - `sourceId` validation;
  - blocking wait behavior;
  - terminal status mapping, including internal `skipped` -> public `completed`;
  - final result fields such as `runId`, counters, and `errorCode`.
- Record re-ingest results in a structured form that fits the current server conventions:
  - preserve existing command metadata where it already exists;
  - emit the structured result through the existing `tool_event` / inflight tool-event path;
  - persist the same structured result through the existing `Turn.toolCalls` container rather than creating a new top-level turn field or collection;
  - surface enough structured data for logs, debugging, and later UI inspection without schema churn.
- Keep invalid step configuration as pre-run validation failure, but once a re-ingest step starts successfully, treat terminal outcomes as non-fatal to the rest of the command or flow.

### 7. Tests, Fixtures, And Regression Coverage

The existing test layout already provides most of the right extension points, so the rough implementation plan should target those files rather than inventing a parallel test structure.

- Extend existing unit schema tests:
  - `server/src/test/unit/agent-commands-schema.test.ts`;
  - `server/src/test/unit/flows-schema.test.ts`.
- Extend command runner unit coverage:
  - `server/src/test/unit/agent-commands-runner.test.ts`;
  - existing retry-focused runner tests if they need assertions for the non-retryable `reingest` branch.
- Reuse existing re-ingest service unit coverage in `server/src/test/unit/reingestService.test.ts` for the terminal contract, especially `skipped` -> `completed`.
- Add focused unit coverage for the new markdown resolver helper, including:
  - direct-command local codeInfo2 resolution when no `sourceId` exists;
  - direct-command same-source resolution when `sourceId` exists;
  - flow same-source resolution;
  - codeInfo2 fallback;
  - deterministic other-repo fallback;
  - fail-fast on read/decode errors;
  - invalid UTF-8 failure;
  - path traversal rejection.
- Extend integration coverage around existing flow execution tests, especially:
  - `server/src/test/integration/flows.run.basic.test.ts`;
  - `server/src/test/integration/flows.run.command.test.ts`;
  - `server/src/test/integration/flows.run.errors.test.ts`.
- Add dedicated integration coverage where it keeps the behavior clearer than overloading broad existing tests:
  - direct command run with `markdownFile`;
  - flow `llm` step with `markdownFile`;
  - flow command step executing a command file that contains `markdownFile` and `reingest` items;
  - non-fatal continuation after `completed`, `cancelled`, and `error` re-ingest outcomes.
- Add explicit regression coverage for the most failure-prone branches called out in `Edge Cases And Failure Modes`, especially:
  - markdown missing in every candidate repository;
  - higher-priority markdown file exists but is unreadable or invalid UTF-8;
  - pre-start re-ingest rejection versus post-start terminal `error` result;
  - distinct `callId` values when multiple re-ingest results are recorded in one run;
  - cancellation requested while a blocking re-ingest step is already waiting.
- Reuse temporary test directories and existing fixture patterns (`server/src/test/fixtures/flows`, temp `codex_agents/.../commands` folders) instead of adding a large permanent fixture set up front.

## Shared Helper File Map

Use these exact helper file paths and export names unless a task explicitly says to reuse an existing file in place. These names are repeated here so later tasks can reference concrete locations instead of vague "shared helper" language.

### Markdown Resolver

- File to create: [server/src/flows/markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts)
- Unit test file: [server/src/test/unit/markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts)
- Planned export shape:

```ts
export type MarkdownFileResolutionParams = {
  markdownFile: string;
  sourceId?: string;
  flowSourceId?: string;
};

export async function resolveMarkdownFile(
  params: MarkdownFileResolutionParams,
): Promise<string>;
```

### Shared Command-Item Executor

- File to create: [server/src/agents/commandItemExecutor.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandItemExecutor.ts)
- Planned export shape:

```ts
export async function executeCommandItem(params: {
  item: AgentCommandItem;
  commandName: string;
  stepIndex: number;
  totalSteps: number;
  conversationId: string;
  sourceId?: string;
}): Promise<{ modelId?: string }>;
```

### Re-Ingest Result Builder

- File to create: [server/src/chat/reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts)
- Unit test file: [server/src/test/unit/reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts)
- Planned export shape:

```ts
export function buildReingestToolResult(params: {
  callId: string;
  outcome: ReingestTerminalOutcome;
}): ChatToolResultEvent;
```

### Re-Ingest Step Lifecycle

- File to create: [server/src/chat/reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts)
- Unit test file: [server/src/test/unit/reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts)
- Planned export shape:

```ts
export async function runReingestStepLifecycle(params: {
  conversationId: string;
  modelId: string;
  command: TurnCommandMetadata;
  toolResult: ChatToolResultEvent;
}): Promise<void>;
```

# Tasks

### 1. Add Command Schema Support For `markdownFile` And `reingest`

- Task Status: `__done__`
- Git Commits:
  - `849b09e3` - Fix the Story 45 review follow-up runtime gap for background direct-command re-ingest failures, gate the parser-level T1/T2 logs behind explicit execution/validation opt-ins, align T2 step numbering with 1-based runtime metadata, and add the focused regression coverage plus Task 14 validation updates.
  - `e0826031` - `DEV-[45] - add flow command reingest parity`
  - `9c0aab42` - `DEV-[45] - record task 11 implementation commit`
  - `8547ad72` - `DEV-[45] - support direct command reingest items`
  - `3ec6ba42` - `DEV-[45] - record task 9 implementation commit`
  - `ca664dc2` - Task 1 implementation: command schema union support for `message.markdownFile` and `reingest`, plus required tests, logging, and verification updates.

#### Overview

Update the command JSON parsing layer so Story 45's new command item shapes are accepted or rejected correctly before any runtime behavior changes are attempted. This task is only about command-file schema contracts and command-schema-focused tests, which keeps the first implementation step small and easy to verify.

#### Documentation Locations

- Zod documentation: https://zod.dev/ - use for discriminated unions, strict object parsing, and `superRefine`-style XOR validation between `content` and `markdownFile`.
- TypeScript union and narrowing documentation: https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html - use for updating command-item types so narrowed branches compile after schema expansion.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for extending the existing `node:test` schema coverage in the server unit tests.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- The top-level command-file contract must stay `{ Description, items }`. Do not rename `Description` to `description` and do not rename `items` to `steps`. Re-read the command contract in [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md) before editing [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts).
- `message` stays the existing command LLM item. After this task it must allow exactly one instruction source: `content: string[]` or `markdownFile: string`. Both present or both missing must fail validation in [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts) and in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts).
- Add one new item shape only: `{ "type": "reingest", "sourceId": "<absolute-ingested-root>" }`. `role` must remain fixed to `user` for `message` items. Do not add a second command item type for LLM execution.
- Existing evidence in [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts) shows `AgentCommandMessageItemSchema`, `AgentCommandFileSchema`, and `parseAgentCommandFile(...)` are the current command schema anchors. Start there, then update downstream type narrowing in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) and [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so they no longer assume every command item has `content`.

#### Required Files For This Task

- Read first: [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts), [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts)
- Edit in this task: [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts)

#### Implementation Shape Example

```ts
const AgentCommandMessageItemSchema = z
  .object({
    type: z.literal('message'),
    role: z.literal('user'),
    content: z.array(trimmedNonEmptyString).min(1).optional(),
    markdownFile: trimmedNonEmptyString.optional(),
  })
  .superRefine(exactlyOneOfContentOrMarkdownFile);
```

#### Subtasks

1. [x] Read the Story 45 command contract, then read the existing command schema file and command schema tests before making any edits. Confirm exactly where `message` items are currently defined and how command files are validated.
2. [x] Update [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts) so command `items` become a discriminated union that supports:
   - `message` items with exactly one of `content` or `markdownFile`;
   - `reingest` items with `sourceId`;
   - the existing top-level `{ Description, items }` contract with no renaming.
3. [x] Update command-side type aliases and schema consumers that currently assume command items always expose `content`. At minimum, inspect and fix affected TypeScript narrowing in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) and [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so the command schema expansion compiles cleanly before runtime work begins.
4. [x] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the happy path where a `message` item uses `content`. Purpose: prove the existing inline-content command contract still parses after the schema change.
5. [x] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the happy path where a `message` item uses `markdownFile`. Purpose: prove the new markdown-backed command message shape is accepted.
6. [x] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the happy path where an item uses `{ "type": "reingest", "sourceId": "..." }`. Purpose: prove the new command re-ingest item shape is accepted.
7. [x] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for invalid `message.markdownFile: ""`. Purpose: prove empty-string markdown references are rejected instead of being treated as missing or valid.
8. [x] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the XOR error case where `content` and `markdownFile` are both present. Purpose: prove the parser rejects command messages with two instruction sources.
9. [x] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the XOR error case where `content` and `markdownFile` are both absent. Purpose: prove the parser rejects command messages with no instruction source.
10. [x] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for strict-schema rejection of unknown keys, including an unexpected extra key on a `reingest` item. Purpose: prove the parser remains strict for the new item shapes.
11. [x] Add one observable server log line in [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts) for successful parsing of Story 45 command items. Use the exact message `DEV-0000045:T1:command_schema_item_parsed` and include `context` with `commandName`, `itemIndex`, `itemType`, and `instructionSource` (`content`, `markdownFile`, or `reingest`). Purpose: give the final Manual Playwright-MCP check one stable log line that proves a direct command file containing the new item shapes was parsed through the updated command schema.
12. [x] Update this story file’s Task 1 `Implementation notes` section after the code and tests for this task are complete.
13. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- 
- Read the Story 45 command contract plus the current command schema, command schema tests, agent service, and command runner; confirmed `AgentCommandMessageItemSchema` and `parseAgentCommandFile(...)` are the current validation anchors and `commandsRunner.ts` still assumes every item has `content`.
- Expanded the command item schema into a discriminated union for `message` and `reingest`, added XOR validation for `content` versus `markdownFile`, and kept the top-level `Description` plus `items` contract unchanged.
- Updated command-side consumers to narrow on item type before reading instruction fields; kept pre-runtime handling explicit by rejecting `reingest` execution in `commandsRunner.ts` until the later Story 45 runtime tasks are implemented.
- Added the required schema coverage for inline content, markdown-backed messages, re-ingest items, XOR failures, empty markdown paths, and strict extra-key rejection; also added the required `DEV-0000045:T1:command_schema_item_parsed` parse log with command and item context.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; Prettier required fixes in the touched schema files and one pre-existing server test file, and the final lint pass completed with the repository’s existing import-order warnings but no errors.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log` after fixing the union narrowing call sites exposed by the first wrapper run.
- Testing step 2 passed via `npm run test:summary:server:unit` with `tests run: 1023`, `failed: 0`, and `agent_action: skip_log`, so the full server unit suite stayed green after the schema-only command changes.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 68`, `failed: 0`, and `agent_action: skip_log`, so no log inspection was needed after the build fix.

---

### 2. Add Flow Schema Support For `markdownFile` And `reingest`

- Task Status: `__done__`
- Git Commits:
  - `1b6e3148` - Task 2 implementation: flow schema union support for `llm.markdownFile` and dedicated `reingest`, plus required tests, logging, design updates, and verification notes.

#### Overview

Update the flow JSON parsing layer so Story 45's new flow step shapes are accepted or rejected correctly before any runtime behavior changes are attempted. This task is only about flow-file schema contracts and flow-schema-focused tests, which keeps the work small and easy to verify.

#### Documentation Locations

- Zod documentation: https://zod.dev/ - use for discriminated unions, strict object parsing, and XOR validation between `messages` and `markdownFile`.
- TypeScript union and narrowing documentation: https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html - use for updating the expanded flow-step union and downstream narrowing in runtime code.
- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for any `design.md` diagram updates tied to the new flow contracts.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for extending the existing `node:test` flow schema coverage.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- The flow-file contract must stay `{ description, steps }`. Existing `command`, `break`, and `startLoop` step shapes remain valid unless Story 45 explicitly extends them. Re-read the flow contract in [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md) before editing [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts).
- `llm` must allow exactly one instruction source: `messages: FlowMessage[]` or `markdownFile: string`. Both present or both missing must fail validation in [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts) and in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts).
- Add one new flow step shape only: `{ "type": "reingest", "sourceId": "<absolute-ingested-root>", "label"?: string }`. This task is schema-only, so do not implement runtime behavior here.
- Existing evidence in [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts) shows `FlowLlmStepSchema`, `FlowCommandStepSchema`, `FlowStepSchema`, `flowStepUnionSchema()`, and `parseFlowFile(...)` are the current flow schema anchors. Update TypeScript narrowing in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) so later runtime tasks compile cleanly even for flows containing only `reingest` steps.

#### Required Files For This Task

- Read first: [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts), [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts)
- Edit in this task: [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)

#### Implementation Shape Example

```ts
const FlowLlmStepSchema = z
  .object({
    type: z.literal('llm'),
    agentType: trimmedNonEmptyString,
    identifier: trimmedNonEmptyString,
    messages: z.array(FlowMessageSchema).min(1).optional(),
    markdownFile: trimmedNonEmptyString.optional(),
  })
  .superRefine(exactlyOneOfMessagesOrMarkdownFile);
```

#### Subtasks

1. [x] Read the Story 45 flow contract, then read the existing flow schema file and flow schema tests before making any edits. Confirm exactly where `llm`, `command`, `break`, `startLoop`, and the discriminated union are currently defined.
2. [x] Update [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts) so the flow step union supports:
   - `llm` steps with exactly one of `messages` or `markdownFile`;
   - `reingest` steps with `sourceId` and optional `label`;
   - unchanged `command`, `break`, and `startLoop` steps.
3. [x] Update flow-side type aliases and schema consumers that currently assume flow steps only include the existing four step types. At minimum, inspect and fix affected TypeScript narrowing in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) so the expanded step union compiles cleanly before runtime work begins.
4. [x] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the happy path where an `llm` step uses `messages`. Purpose: prove the existing flow LLM contract still parses after schema expansion.
5. [x] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the happy path where an `llm` step uses `markdownFile`. Purpose: prove the new markdown-backed flow LLM step shape is accepted.
6. [x] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the happy path where a step uses `{ "type": "reingest", "sourceId": "..." }`. Purpose: prove the new flow re-ingest step shape is accepted.
7. [x] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for a flow whose executable steps are all `reingest`. Purpose: prove schema validation allows reingest-only flows before runtime work starts.
8. [x] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for invalid `llm.markdownFile: ""`. Purpose: prove empty-string markdown references are rejected instead of being treated as missing or valid.
9. [x] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the XOR error case where `messages` and `markdownFile` are both present. Purpose: prove the parser rejects flow LLM steps with two instruction sources.
10. [x] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the XOR error case where `messages` and `markdownFile` are both absent. Purpose: prove the parser rejects flow LLM steps with no instruction source.
11. [x] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for strict-schema rejection of unknown keys, including an unexpected extra key on a `reingest` step. Purpose: prove the parser remains strict for the new flow step shapes.
12. [x] Add one observable server log line in [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts) for successful parsing of Story 45 flow steps. Use the exact message `DEV-0000045:T2:flow_schema_step_parsed` and include `context` with `flowName`, `stepIndex`, `stepType`, `label`, and `instructionSource` (`messages`, `markdownFile`, or `reingest`). Purpose: give the final Manual Playwright-MCP check one stable log line that proves a flow using the new `llm.markdownFile` or dedicated `reingest` shapes parsed through the updated flow schema.
13. [x] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: add the final Story 45 flow-file contract for `llm.markdownFile` and the dedicated `reingest` step shape, and add or refresh Mermaid diagrams that show those step variants using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent architecture/design reference aligned with the supported flow schema.
14. [x] Update this story file’s Task 2 `Implementation notes` section after the code and tests for this task are complete.
15. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- 
- Read the Story 45 flow contract plus the current flow schema, flow schema tests, flow service, and design doc context; confirmed `FlowLlmStepSchema`, `flowStepUnionSchema()`, and `parseFlowFile(...)` are the current schema anchors and the flow runner still assumes `llm` steps always expose `messages`.
- Expanded the flow schema so `llm` accepts exactly one of `messages` or `markdownFile`, added the dedicated `reingest` step shape, and kept the top-level `{ description, steps }` contract plus existing `command`, `break`, and `startLoop` shapes intact.
- Updated flow-side parsing consumers to pass `flowName` into `parseFlowFile(...)` for the required Task 2 observability and tightened flow service narrowing so the widened step union compiles cleanly without starting the later runtime behavior.
- Added the required flow schema coverage for message-backed LLM steps, markdown-backed LLM steps, dedicated re-ingest steps, reingest-only flows, XOR failures, empty markdown paths, and strict extra-key rejection; also added the required `DEV-0000045:T2:flow_schema_step_parsed` parse log.
- Updated `design.md` to document the Story 45 flow-file schema contract and added a Mermaid flowchart for the new `llm.markdownFile` and `reingest` step variants; Context7 Mermaid lookup was unavailable in this environment, so the update used the existing Mermaid syntax style already present in the repo.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; both passed with the repository’s standing import-order warning baseline and no new Task 2-specific lint or formatting issues after reordering the added flow service import.
- Testing step 1 passed via `npm run build:summary:server` with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the schema and service typing updates built cleanly.
- Testing step 2 passed via `npm run test:summary:server:unit` with `tests run: 1030`, `failed: 0`, and `agent_action: skip_log`, so the full server unit suite stayed green after the flow schema expansion.
- Testing step 3 passed via `npm run test:summary:server:cucumber` with `tests run: 68`, `failed: 0`, and `agent_action: skip_log`, so the existing cucumber suite stayed green after the flow schema expansion.

---

### 3. Add The Shared Markdown Resolver And Its Safety Rules

- Task Status: `__done__`
- Git Commits:
  - `84e7fb5a` - Task 3 implementation: shared markdown resolver, resolver unit coverage, project-structure updates, and verification notes.

#### Overview

Create the shared markdown-file lookup and decoding helper that all later markdown-backed runtime work will depend on. This task only implements repository candidate ordering, path validation, strict UTF-8 decoding, and focused unit coverage for that helper.

#### Documentation Locations

- Node.js path documentation: https://nodejs.org/api/path.html - use for safe relative-path validation, normalization, and escape prevention under `codeinfo_markdown`.
- Node.js file system documentation: https://nodejs.org/api/fs.html - use for reading markdown files as raw bytes and handling file-missing versus file-read failures correctly.
- Node.js `util.TextDecoder` documentation: https://nodejs.org/api/util.html#class-utiltextdecoder - use for strict UTF-8 decoding with fatal error handling so invalid bytes fail clearly.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for writing the resolver-focused `node:test` unit coverage in this task.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- `markdownFile` is always relative to a repository-level `codeinfo_markdown` folder. Reject empty values, absolute paths, `..` traversal, and any normalized path that escapes the resolved `codeinfo_markdown` root. Re-read the markdown resolution contract in [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md) before writing the helper.
- Repository lookup order must be deterministic: same-source repository first, then codeInfo2, then other ingested repositories sorted by case-insensitive label and then full source path. Missing files fall through to the next candidate; unreadable files, invalid UTF-8, or unsafe-path failures in a higher-priority candidate must fail immediately.
- Direct command runs must reuse existing upstream repository context when it already exists. Commands started through [startAgentCommand()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) or [runAgentCommand()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) with a `sourceId` must use that repository as same-source context; direct commands without `sourceId` fall back to the local codeInfo2 checkout. Flow `llm` steps and flow-owned command steps may use same-source plus fallback ordering. This distinction must be enforced by the shared resolver instead of by scattered call-site logic.
- Existing evidence in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) shows the repository ordering logic already exists there. Reuse that logic or extract it cleanly; do not invent a second ordering algorithm. Keep decoding strict by reading bytes first and decoding with a fatal UTF-8 path documented at https://nodejs.org/api/util.html#class-utiltextdecoder.

#### Required Files For This Task

- Read first: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts)
- Create in this task: [markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts), [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts)

#### Implementation Shape Example

```ts
export async function resolveMarkdownFile(params: {
  markdownFile: string;
  sourceId?: string;
  flowSourceId?: string;
}): Promise<string> {
  // validate path, build candidate roots, read bytes, decode UTF-8 strictly
}
```

#### Subtasks

1. [x] Read the Story 45 markdown-resolution contract and the existing flow repository-ordering helpers in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) before creating any new helper.
2. [x] Create [markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts) and export `resolveMarkdownFile(params)` using the exact helper contract from `Shared Helper File Map`. That file must:
   - validates safe relative `markdownFile` paths under `codeinfo_markdown`;
   - rejects empty values, absolute paths, and traversal/escape attempts;
   - builds candidate repositories in the documented same-source, codeInfo2, other-repos order;
   - continues on missing files only;
   - fails immediately when a higher-priority candidate contains the file but it cannot be read or decoded.
3. [x] Implement strict UTF-8 decoding in that resolver using a byte-first Node path rather than permissive string reads. Read raw bytes first, then decode with a strict decoder (`TextDecoder` with `fatal: true` or an equivalent strict Buffer-based path) so invalid bytes fail clearly instead of being silently replaced.
4. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for a direct command with no `sourceId`. Purpose: prove local direct commands still resolve markdown from the codeInfo2 repository when no upstream repository context exists.
5. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for a direct command with an ingested-repository `sourceId`. Purpose: prove direct commands reuse the existing service-level `sourceId` as same-source markdown context.
6. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for same-source flow lookup. Purpose: prove flow-owned markdown resolution prefers the parent flow repository first.
7. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for codeInfo2 fallback after same-source miss. Purpose: prove the documented fallback order is used.
8. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for deterministic other-repository fallback. Purpose: prove fallback reaches non-codeInfo2 repositories only after the higher-priority candidates miss.
9. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for a valid root-level markdown lookup such as `file.md`. Purpose: prove files directly inside `codeinfo_markdown` are accepted.
10. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for a valid nested-subpath lookup such as `subdir/file.md`. Purpose: prove safe nested paths are accepted when they stay inside `codeinfo_markdown`.
11. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for valid UTF-8 markdown containing non-ASCII characters that is returned verbatim. Purpose: prove strict decoding still preserves valid Unicode content unchanged.
12. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for deterministic tie-breaking when fallback repositories share the same case-insensitive source label. Purpose: prove path ordering is used as the stable final tie-breaker.
13. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for the all-candidates-missing error path. Purpose: prove the resolver fails clearly instead of returning an empty instruction.
14. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for a higher-priority unreadable file. Purpose: prove unreadable content blocks fallback instead of being silently skipped.
15. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for an explicit permission/read error such as `EACCES` or `EPERM`. Purpose: prove permission failures are surfaced clearly as fail-fast resolver errors.
16. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for invalid UTF-8 failure. Purpose: prove strict decoding rejects invalid bytes instead of replacing them silently.
17. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for empty-path rejection. Purpose: prove blank markdown paths are rejected before any file read occurs.
18. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for absolute-path rejection. Purpose: prove absolute markdown paths cannot escape the repository contract.
19. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for `..` traversal rejection. Purpose: prove parent-directory traversal is blocked before candidate resolution begins.
20. [x] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for normalized escape-attempt rejection. Purpose: prove paths that normalize outside `codeinfo_markdown` are still rejected.
21. [x] Add one observable server log line in [markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts) when a markdown file resolves successfully. Use the exact message `DEV-0000045:T3:markdown_file_resolved` and include `context` with `markdownFile`, `resolutionScope` (`direct-command`, `flow-llm`, or `flow-command`), `resolvedSourceId`, `resolvedRepositoryLabel`, and `resolvedPath`. Purpose: give the final Manual Playwright-MCP check one stable log line that proves the shared resolver picked the expected repository and file.
22. [x] Update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after all file additions or removals in this task are finished. Location: repository root. Description: record every file path added or removed by this task, including the new shared markdown resolver module created in Subtask 2, the new unit test file [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts), and any replaced or deleted helper file path if the repository-ordering logic is moved rather than reused in place. Purpose: keep the repository structure reference accurate for later developers and make the full file-level impact of this task discoverable.
23. [x] Update this story file’s Task 3 `Implementation notes` section after the code and tests for this task are complete.
24. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Reviewed the Story 45 markdown-resolution contract plus the existing flow repository-ordering helpers in `server/src/flows/service.ts`; the shared resolver will reuse the same same-source/codeInfo2/other ordering instead of introducing a second algorithm.
- Added `server/src/flows/markdownFileResolver.ts` with safe relative-path validation, deterministic same-source/codeInfo2/other candidate ordering, and fail-fast behavior for unreadable or undecodable higher-priority files.
- Implemented byte-first markdown reads plus strict UTF-8 decoding via `TextDecoder(..., { fatal: true })`, and added the required `DEV-0000045:T3:markdown_file_resolved` success log with repository/file context.
- Added the focused resolver unit suite in `server/src/test/unit/markdown-file-resolver.test.ts` covering direct-command context reuse, flow same-source lookup, codeInfo2 fallback, other-repo ordering, path safety checks, unreadable-file failures, permission failures, and invalid UTF-8 handling.
- Updated `projectStructure.md` with the new resolver module, the new resolver unit test file, and the supporting Task 3 implementation traceability entries.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; formatting initially failed on the new resolver files, so I applied Prettier and fixed the new import-order warnings until lint was back to the repo’s existing warning baseline and format checks passed.
- Ran `npm run build:summary:server`; the first pass failed on an overly broad test-hook `readFile` type, so I narrowed the resolver dependency to the byte-read signature it actually uses and the rerun passed cleanly with `warning_count: 0`.
- Ran `npm run test:summary:server:unit`; the first full pass exposed an incorrect tie-break expectation in the new same-label fallback test, so I corrected the assertion to match the documented path-order rule and the rerun passed with `tests run: 1047`, `failed: 0`.
- Ran `npm run test:summary:server:cucumber`; the suite passed cleanly with `tests run: 68`, `failed: 0`, confirming the shared resolver work did not regress server feature coverage.

---

### 4. Support `message.markdownFile` In Direct Agent Command Runs

- Task Status: `__done__`
- Git Commits:
  - `26234ef2` - Task 4 implementation: direct command markdown message execution, runtime tests, integration coverage, and verification notes.

#### Overview

Teach the direct command runner to execute markdown-backed `message` items without changing flow behavior yet. This task is only about direct command `message.markdownFile` execution, preserving the existing retry logic for AI instruction steps and reusing the shared resolver from Task 3.

#### Documentation Locations

- TypeScript union and narrowing documentation: https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html - use for narrowing between command `message` items that carry `content` versus `markdownFile`.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the direct-command unit and integration tests extended in this task.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- This task is direct-command `message.markdownFile` only. Do not add `reingest` execution here and do not change flow behavior here. The instruction contract remains: one command `message` item becomes one user instruction string.
- Existing evidence in [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) shows `runAgentCommandRunner(...)` is the execution entry point and already uses `runWithRetry(...)` for message execution. Keep that retry path for `message` items; only change how the instruction string is produced.
- Inline `content` keeps the current `content.join('\\n')` behavior. `markdownFile` must load exactly one markdown file through the shared resolver from Task 3 and pass the markdown through verbatim as one instruction string. Reuse the existing direct-command `sourceId` input from [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) so commands started from an ingested repository get same-source markdown lookup before codeInfo2 fallback.
- Startup metadata also needs protection in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), because the current command-start code inspects early items. Keep this simple: do not resolve markdown just to generate a prettier title. A generic fallback title is acceptable when the first item has no inline `content`.

#### Required Files For This Task

- Read first: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts), [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts)
- Edit in this task: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts), [commands.markdown-file.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.markdown-file.test.ts)

#### Implementation Shape Example

```ts
const instruction =
  item.type === 'message' && 'markdownFile' in item
    ? await resolveMarkdownFile({ markdownFile: item.markdownFile, sourceId })
    : item.content.join('\n');
```

#### Subtasks

1. [x] Read [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) and the existing runner tests before changing direct command execution.
2. [x] Update [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) and [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so direct-command execution passes the existing optional `sourceId` into `resolveMarkdownFile(...)` from [markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts) whenever a command run has upstream repository context.
3. [x] Update [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so `message` items:
   - keep the current `content.join('\n')` behavior when `content` is used;
   - resolve one markdown file into one instruction string when `markdownFile` is used;
   - use same-source repository scope when the command was started with `sourceId`, otherwise fall back to the local codeInfo2 checkout.
4. [x] Keep the existing retry path for message-based agent instruction execution. This task must not add `reingest` execution yet and must not change retry-prompt behavior for `message` items.
5. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for the happy path where one direct command item uses `message.markdownFile`. Purpose: prove the runner loads one markdown instruction and executes it once.
6. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) proving the loaded markdown is passed through verbatim. Purpose: prove the runner does not trim, split, or rewrite markdown content before sending it to the agent.
7. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for multiple `message.markdownFile` items in one direct command run. Purpose: prove each markdown item becomes its own instruction and execution order is preserved.
8. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a direct command that mixes `message.markdownFile` and `message.content`. Purpose: prove inline-content behavior stays unchanged when mixed with markdown-backed items.
9. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a direct command started with repository `sourceId` where same-source markdown wins over codeInfo2. Purpose: prove the runner reuses the existing upstream repository context instead of discarding it.
10. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a direct command started with repository `sourceId` where same-source misses and codeInfo2 fallback is used. Purpose: prove direct-command markdown resolution still follows the documented fallback order after same-source lookup.
11. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for the error path where a markdown file is missing. Purpose: prove direct command execution fails clearly instead of silently continuing with empty content.
12. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for the error path where a markdown file is undecodable. Purpose: prove invalid markdown bytes surface as a clear command failure.
13. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for an unexpected resolver exception. Purpose: prove unexpected markdown-loader failures surface as clear command errors.
14. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for the existing inline `content` path after the markdown change. Purpose: prove the original direct-command message behavior remains intact.
15. [x] Add one integration test in [commands.markdown-file.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.markdown-file.test.ts) for a local direct command with `message.markdownFile`. Purpose: prove the full service-to-runner path still executes markdown-backed command items successfully when no repository `sourceId` is supplied.
16. [x] Add one integration test in [commands.markdown-file.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.markdown-file.test.ts) for a direct command started with repository `sourceId` where same-source markdown wins over codeInfo2. Purpose: prove the service/runner handoff preserves upstream repository context in the full direct-command path.
17. [x] Add one integration test in [commands.markdown-file.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.markdown-file.test.ts) for a direct command started with repository `sourceId` where same-source markdown misses and codeInfo2 fallback is used. Purpose: prove the full direct-command path applies the documented fallback order after same-source lookup.
18. [x] Update direct-command startup metadata paths in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) so command title generation, first-step inspection, and any pre-run assumptions remain safe when the first command item uses `markdownFile` or `reingest` instead of `content`. Keep this intentionally simple: do not resolve markdown files at command-start time just to improve the title; a generic `Command: <name>` fallback is acceptable when no inline content exists yet.
19. [x] Add one observable server log line in [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) when a direct command executes a markdown-backed message item. Use the exact message `DEV-0000045:T4:direct_command_markdown_message_loaded` and include `context` with `commandName`, `itemIndex`, `markdownFile`, `resolvedSourceId`, and `instructionLength`. Purpose: give the final Manual Playwright-MCP check one stable log line that proves a direct command message item loaded markdown and turned it into one instruction.
20. [x] Update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after all file additions or removals in this task are finished. Location: repository root. Description: record every file path added or removed by this task, including the direct-command markdown integration test file [commands.markdown-file.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.markdown-file.test.ts), any permanent fixture directory created for those tests, and any helper file created or removed to support direct-command markdown execution. Purpose: keep the repository structure reference accurate for later developers and make the full file-level impact of this task discoverable.
21. [x] Update this story file’s Task 4 `Implementation notes` section after the code and tests for this task are complete.
22. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Reviewed the direct command runner, the startup metadata path in `server/src/agents/service.ts`, the shared markdown resolver, and the existing runner tests; Task 4 needs to thread `sourceId` through the existing direct-command path without changing retry behavior or eagerly resolving markdown for titles.
- Threaded `sourceId` from `server/src/agents/service.ts` into `runAgentCommandRunner(...)`, kept the existing retry path intact, and updated startup title generation so markdown-backed or non-inline first items fall back to `Command: <name>` instead of trying to inspect or resolve markdown early.
- Updated `server/src/agents/commandsRunner.ts` to resolve markdown-backed message items through the shared resolver before execution, keep inline `content.join('\n')` behavior unchanged, and emit `DEV-0000045:T4:direct_command_markdown_message_loaded` with the resolved source context.
- Expanded `server/src/test/unit/agent-commands-runner.test.ts` with direct-command markdown happy-path, verbatim-content, ordering, mixed-item, same-source, fallback, missing-file, invalid-UTF8, unexpected-resolver, and inline-regression coverage using temporary markdown repositories.
- Added `server/src/test/integration/commands.markdown-file.test.ts` to exercise the full direct-command service-to-runner path for local markdown execution plus sourceId same-source and fallback behavior, and added a small `agents/service.ts` test hook so the integration tests can steer ingested repository lookup without changing production APIs.
- Updated `projectStructure.md` for the new direct-command markdown integration test and the supporting Task 4 file changes.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; lint initially failed on new import-order and unused-variable issues in the Task 4 files, so I fixed those, reran Prettier on the expanded runner test, and got lint back to the repo’s existing 45-warning baseline with format checks passing cleanly.
- Ran `npm run build:summary:server`; the first pass failed on a missed `agentHome` rename inside the new integration file, so I restored that local scaffold binding for the local-command scenario and the rerun passed cleanly with `warning_count: 0`.
- Ran `npm run test:summary:server:unit`; the first full pass exposed missing resolver-listing hooks in the new integration tests, so I proved the fix with a targeted wrapper on `server/src/test/integration/commands.markdown-file.test.ts`, then reran the full suite successfully with `tests run: 1060`, `failed: 0`.
- Ran `npm run test:summary:server:cucumber`; the suite passed cleanly with `tests run: 68`, `failed: 0`, confirming the direct-command markdown changes did not regress server feature coverage.

---

### 5. Support `llm.markdownFile` In Flow Steps

- Task Status: `__done__`
- Git Commits:
  - `e380c4bd` - Task 5 implementation: flow `llm.markdownFile` runtime execution, integration coverage, design notes, and validation results.

#### Overview

Teach the flow runner to execute markdown-backed `llm` steps using the shared markdown resolver and the current flow repository context. This task is only about flow `llm` steps and must not yet change flow command-step item execution or any re-ingest behavior.

#### Documentation Locations

- TypeScript union and narrowing documentation: https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html - use for handling flow `llm` steps that now branch between `messages` and `markdownFile`.
- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for any `design.md` diagram updates tied to flow `llm.markdownFile` behavior.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the integration tests that prove flow markdown execution and fallback ordering.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- This task is flow `llm.markdownFile` only. Do not add `reingest` behavior and do not modify flow-owned command-step execution here. The `llm` instruction contract remains one step -> one instruction execution.
- Existing evidence in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) shows `runLlmStep(...)` is the current execution anchor and today iterates `step.messages`. Add the `markdownFile` branch there so one markdown file resolves to one user instruction string executed once.
- Keep current `messages` behavior unchanged for existing flows, including current retry behavior and current persistence of successful or failed agent turns. This task should only add the alternate instruction source, not change the surrounding flow-turn lifecycle.
- The markdown lookup rules from Task 3 must be repeated here: same-source repository first, then codeInfo2, then deterministic fallback repositories; unreadable higher-priority files fail fast; direct markdown bytes must pass through verbatim after strict UTF-8 decoding.

#### Required Files For This Task

- Read first: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts), [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts)
- Edit in this task: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)

#### Implementation Shape Example

```ts
if (step.type === 'llm' && 'markdownFile' in step) {
  const instruction = await resolveMarkdownFile({
    markdownFile: step.markdownFile,
    flowSourceId: sourceId,
  });
}
```

#### Subtasks

1. [x] Read the current `runLlmStep(...)` path in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) and the existing flow execution tests before making changes.
2. [x] Update [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) so an `llm` step with `markdownFile` calls `resolveMarkdownFile(...)` from [markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts), converts the returned markdown into exactly one instruction string, and executes it once through the existing agent-turn path.
3. [x] Keep the current `messages` array behavior unchanged for existing flow `llm` steps, including current retry behavior and current turn persistence for successful and failed agent turns.
4. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for same-source markdown resolution in an `llm.markdownFile` step. Purpose: prove the parent flow repository is the first lookup candidate.
5. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) proving loaded markdown is passed through verbatim as one instruction string. Purpose: prove flow `llm` markdown content is not rewritten before execution.
6. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for fallback to codeInfo2 after a same-source miss. Purpose: prove the first fallback candidate in the documented repository order is applied correctly.
7. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for fallback to another ingested repository after same-source and codeInfo2 misses. Purpose: prove the final fallback tier in the documented repository order is applied correctly.
8. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for a higher-priority unreadable markdown file. Purpose: prove flow execution fails fast instead of falling through to a lower-priority repository.
9. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for duplicate-label fallback ordering. Purpose: prove same-label repositories still resolve deterministically by full path.
10. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for a missing markdown file. Purpose: prove flow execution fails clearly instead of producing an empty instruction.
11. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for an undecodable markdown file. Purpose: prove invalid markdown bytes surface as a clear flow-step failure.
12. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for an unexpected markdown-resolver exception. Purpose: prove unexpected loader failures surface as clear flow-step errors.
13. [x] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) where a successful `llm.markdownFile` step is followed by a later step. Purpose: prove the happy-path flow sequence continues after markdown execution.
14. [x] Add one observable server log line in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) when a flow `llm` step executes via `markdownFile`. Use the exact message `DEV-0000045:T5:flow_llm_markdown_loaded` and include `context` with `flowName`, `stepIndex`, `markdownFile`, `resolvedSourceId`, and `instructionLength`. Purpose: give the final Manual Playwright-MCP check one stable log line that proves a flow `llm` step resolved markdown and executed it as one instruction.
15. [x] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document flow `llm.markdownFile` execution, repository fallback ordering, and the one-instruction execution path, and add or refresh the Mermaid diagram for this flow-step behavior using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent flow architecture documentation aligned with the implemented runtime behavior.
16. [x] Update this story file’s Task 5 `Implementation notes` section after the code and tests for this task are complete.
17. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Reviewed `runLlmStep(...)`, the shared markdown resolver, and the existing flow integration harness in `server/src/test/integration/flows.run.basic.test.ts`; Task 5 needs to add the markdown branch at the current flow `llm` execution anchor without changing the surrounding flow-turn lifecycle.
- Updated `runLlmStep(...)` to keep the existing `messages` path intact, resolve `llm.markdownFile` through the shared resolver, and emit `DEV-0000045:T5:flow_llm_markdown_loaded`; markdown resolver failures now persist as explicit failed flow steps instead of vanishing into the async run shell.
- Added a dedicated markdown-flow harness plus the required integration matrix in `flows.run.basic.test.ts`; the tests explicitly steer both `startFlowRun(...)` and the shared markdown resolver repo source so fallback and failure cases do not leak to the real Chroma-backed repository listing.
- Updated `design.md` for the new flow markdown runtime path and repository-order diagram; Context7 Mermaid lookup was unavailable because the session’s Context7 API key was invalid, so the diagram update follows the repository’s existing Mermaid patterns instead.
- Ran the required repo-wide lint and format checks; `format:check` initially failed on the touched files, so `npm run format --workspace server` was applied and the final lint pass returned to the repo’s existing 42-warning baseline with no new errors.
- Validation wrapper `npm run build:summary:server` passed cleanly with `warning_count: 0`, so the Task 5 runtime and test additions compile within the standard server wrapper path.
- Targeted `flows.run.basic.test.ts` wrapper coverage passed after fixing the new harness cleanup, and the full `npm run test:summary:server:unit` wrapper then passed with `tests run: 1070` and `failed: 0`.
- `npm run test:summary:server:cucumber` passed cleanly with `tests run: 68` and `failed: 0`, so the flow markdown runtime changes did not regress server feature coverage outside the node:test suite.

---

### 6. Reuse Command `message` Item Execution Inside Flow Command Steps

- Task Status: `__done__`
- Git Commits:
  - `372ed2a9` - `DEV-[45] - share command message execution for flow command steps`

#### Overview

Make flow command steps execute command `message` items through the same markdown-aware logic as direct commands. This task is only about flow-owned command execution for `message` items, so it can be tested independently before any `reingest` item work starts. Keep the change narrow: share message-item resolution and dispatch logic, but do not rework the surrounding flow command-step retry model unless the implementation proves it is strictly necessary.

#### Documentation Locations

- TypeScript union and narrowing documentation: https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html - use for shared command-item helpers that must narrow message-item variants safely in both direct-command and flow-command paths.
- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for any `design.md` diagram updates tied to shared flow-command execution.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the flow-command integration tests extended in this task.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- This task is flow-owned command execution for `message` items only. Do not add `reingest` items here. The goal is to share message-item behavior, not to rewrite the whole flow command-step runner.
- Existing evidence shows [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) owns direct-command item execution and [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) owns flow command-step orchestration. Do not call `runAgentCommandRunner(...)` directly from the flow runner, because lock ownership and outer orchestration differ. Extract only the minimum shared helper needed for message-item preparation and dispatch.
- Keep retry behavior where it already lives: direct commands stay on the current `commandsRunner.ts` retry path, and flow command steps stay on their current outer flow-step retry path. The shared helper should centralize message-item resolution and execution, not retry policy.
- Repeat the repository rule inside this task: when a command runs inside a flow, `markdownFile` resolution uses the parent flow’s same-source repository first, then codeInfo2, then deterministic fallback repositories. A higher-priority unreadable markdown file must fail instead of silently falling through.

#### Required Files For This Task

- Read first: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [markdownFileResolver.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/markdownFileResolver.ts), [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts)
- Create or edit in this task: [commandItemExecutor.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandItemExecutor.ts), [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts)

#### Implementation Shape Example

```ts
export async function executeCommandItem(params: {
  item: AgentCommandItem;
  sourceId?: string;
  flowSourceId?: string;
}): Promise<{ modelId?: string }> {
  // message.content and message.markdownFile live here
}
```

#### Subtasks

1. [x] Read the current flow command-step execution loop in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) and compare it to the direct command path in [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts).
2. [x] Do not call [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) directly from flow execution. Instead, create or update [commandItemExecutor.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandItemExecutor.ts) and export `executeCommandItem(params)` so both direct-command and flow-command paths can share item execution while preserving their different lock ownership and outer step orchestration responsibilities.
3. [x] Keep the existing outer retry behavior on each caller unchanged unless implementation proves otherwise:
   - direct commands continue to use the current `commandsRunner.ts` retry path;
   - flow command steps continue to use their current outer flow-step retry path;
   - the shared helper should focus on message-item instruction preparation and execution dispatch, not on rewriting the surrounding retry model.
4. [x] Make that shared command-item execution helper handle the shared `message`-item behavior for:
   - `content` items;
   - `markdownFile` items;
   - repository-context-aware resolution when a command is executed from inside a flow.
5. [x] Keep this task focused on `message` items only. Do not add `reingest` item execution in this task.
6. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a flow command step whose command file contains one `message.markdownFile` item. Purpose: prove flow-owned commands can execute markdown-backed message items at all.
7. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for multiple `message.markdownFile` items in one flow-owned command file. Purpose: prove item ordering and repeated markdown resolution both work.
8. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a command file that mixes `message.markdownFile` and `message.content`. Purpose: prove inline-content behavior remains unchanged inside flow-owned command execution.
9. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for same-source repository context use. Purpose: prove flow-owned commands check the parent flow repository before fallback candidates.
10. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for fallback repository context use after a same-source miss. Purpose: prove flow-owned commands follow the documented repository fallback order.
11. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a higher-priority unreadable markdown file. Purpose: prove the command step fails fast instead of silently falling through.
12. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) comparing message-item resolution and execution behavior with the direct-command path. Purpose: prove the shared helper does not drift from direct-command semantics.
13. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for surrounding retry behavior after the shared-helper refactor. Purpose: prove the flow command-step retry model and direct-command retry model remain unchanged where they already existed.
14. [x] Add one observable server log line in [commandItemExecutor.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandItemExecutor.ts) when a flow-owned command step executes a `message` item. Use the exact message `DEV-0000045:T6:flow_command_message_item_executed` and include `context` with `flowName`, `stepIndex`, `commandName`, `itemIndex`, `instructionSource`, and `resolvedSourceId` when markdown is used. Purpose: give the final Manual Playwright-MCP check one stable log line that proves flow command steps are reusing the shared message-item execution path.
15. [x] Update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after all file additions or removals in this task are finished. Location: repository root. Description: record every file path added or removed by this task, including the exact shared command-item execution module path created by Subtask 2 if extraction produces a new file, any companion test file added for that shared helper, and any superseded helper file removed during the extraction. Purpose: keep the repository structure reference accurate after shared execution code is introduced and make the full file-level impact of this task discoverable.
16. [x] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: explain the shared command-item execution path used by direct commands and flow command steps, and add or refresh the Mermaid diagram for this shared flow-command path using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent architecture documentation aligned with the intended shared execution design.
17. [x] Update this story file’s Task 6 `Implementation notes` section after the code and tests for this task are complete.
18. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Compared the direct-command runner and the flow command-step loop; Task 6 can extract shared `message` item preparation/execution, but flow orchestration still has to keep its own outer retry, stop-handoff, and command-file-loading behavior.
- Added `server/src/agents/commandItemExecutor.ts` and rewired both callers to use it for shared `message` item preparation and dispatch; direct commands still resolve their original instruction once before `runWithRetry(...)`, while flow command steps still keep their own outer command-step lifecycle and now persist explicit failures when shared markdown loading throws.
- Extended `flows.run.command.test.ts` with Task 6 coverage for markdown-backed flow-owned commands, mixed message-item files, same-source and fallback markdown resolution, unreadable higher-priority files, direct-command parity, and retry-model preservation after the shared helper extraction.
- Updated `projectStructure.md` to record the new shared command-item executor file and the Task 6 traceability set so later Story 45 runtime tasks can find the shared module quickly.
- Updated `design.md` with the shared direct-command and flow-command `message` execution path plus a Mermaid flowchart; Context7 Mermaid lookup was unavailable because the session API key was invalid, so the diagram follows the repo’s existing Mermaid style.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; lint returned to the repo’s existing warning-only baseline after fixing the new helper import order, and `format:check` passed after formatting the Task 6 integration test file.
- `npm run build:summary:server` passed with `warning_count: 0`, so the shared executor extraction and flow-command refactor compile cleanly through the wrapper path.
- `npm run test:summary:server:unit` passed with `tests run: 1078` and `failed: 0`; an earlier full-suite wrapper instance stalled in heartbeat-only mode, so I killed it, confirmed `flows.run.loop.test.ts` still passed in isolation, and reran the full wrapper cleanly to completion.
- `npm run test:summary:server:cucumber` passed with `tests run: 68` and `failed: 0`, so the shared message-item extraction did not regress the server Cucumber behavior surface.

---

### 7. Add Shared Re-Ingest Result Payload Builder

- Task Status: `__done__`
- Git Commits:
  - `78cb8ef7` - `DEV-[45] - add shared reingest tool-result builder`

#### Overview

Implement the shared runtime helper or code path that converts re-ingest terminal outcomes into the exact nested payload and wrapper shapes required by Story 45. This task is only about payload contracts and shape-focused tests, which keeps the work small and easy to verify before any runtime lifecycle code is added.

#### Documentation Locations

- Mongoose SchemaTypes documentation: https://mongoosejs.com/docs/schematypes.html - use for confirming that `Schema.Types.Mixed` is the correct existing persistence slot for nested `toolCalls` payloads.
- `ws` package documentation: https://github.com/websockets/ws/blob/master/doc/ws.md - use for understanding the underlying WebSocket server behavior that the repo’s publish helpers sit on top of.
- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for any `design.md` diagram updates tied to re-ingest result flow.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the payload-builder unit tests extended in this task.
- TypeScript union and narrowing documentation: https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html - use for shaping the shared payload builder types and wrapper contracts.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- This task is payload-contract work only. Do not wire runtime execution yet. The output must fit the existing `tool-result` event/container shapes instead of adding new websocket events, new Mongo collections, or new top-level conversation flags.
- The nested result payload must match Story 45 exactly: `kind: "reingest_step_result"`, `stepType: "reingest"`, `sourceId`, terminal `status`, `operation`, `runId`, counters, and `errorCode`. Re-copy that payload from [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md) before coding.
- Existing evidence in [inflightRegistry.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts), [ChatInterface.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/interfaces/ChatInterface.ts), and [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts) shows the current wrapper shapes already exist. Reuse those exact wrappers for live tool events and persisted `Turn.toolCalls`.
- `Turn.toolCalls` already uses `Schema.Types.Mixed` in [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts), so this task should not add or change Mongo schema fields. Focus on generating correctly shaped data, including distinct stable `callId` values.

#### Required Files For This Task

- Read first: [inflightRegistry.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts), [ChatInterface.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/interfaces/ChatInterface.ts), [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts), [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts)
- Create or edit in this task: [reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts), [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)

#### Implementation Shape Example

```ts
export function buildReingestToolResult(params: {
  callId: string;
  outcome: ReingestTerminalOutcome;
}): ChatToolResultEvent {
  return { type: 'tool-result', callId: params.callId, name: 'reingest_repository', stage: 'success', result: {/* nested payload */} };
}
```

#### Subtasks

1. [x] Read the current `ToolEvent`, `ChatToolResultEvent`, and `Turn.toolCalls` shapes before adding any new payload builder.
2. [x] Create [reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts) and export `buildReingestToolResult(params)` using the exact helper contract from `Shared Helper File Map`. That file must:
   - converts a terminal re-ingest outcome into the nested `reingest_step_result` payload;
   - wraps it in the existing `tool-result` shape for live events and persisted tool calls;
   - reuses the existing `tool_event`, `inflight_snapshot.inflight.toolEvents`, and `Turn.toolCalls` contracts instead of introducing a new websocket event type, new top-level conversation flag, or new persisted collection;
   - keeps the existing Mongoose turn schema untouched because [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts) already stores `toolCalls` as `Schema.Types.Mixed`;
   - includes a stable `callId`;
   - preserves distinct `callId` values when multiple re-ingest results are recorded in one run.
3. [x] Keep this task payload-only. Do not yet add inflight creation, synthetic user turns, assistant turn finalization, or direct/flow re-ingest execution wiring.
4. [x] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for a terminal `completed` re-ingest outcome. Purpose: prove the builder creates the expected nested payload and outer success wrapper for the normal happy path.
5. [x] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for a terminal `cancelled` re-ingest outcome. Purpose: prove cancellation is preserved as structured data without changing the wrapper contract.
6. [x] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for a terminal `error` re-ingest outcome. Purpose: prove error results keep the expected payload fields and stage mapping.
7. [x] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for compatibility with the existing live `tool-result` event shape. Purpose: prove Story 45 reuses the current websocket wrapper contract instead of inventing a new one.
8. [x] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for compatibility with the persisted `Turn.toolCalls` shape. Purpose: prove Story 45 reuses the current persisted wrapper contract instead of inventing a new one.
9. [x] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for multiple results with distinct `callId` values. Purpose: prove separate re-ingest events remain distinguishable within one run.
10. [x] Add one observable server log line in [reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts) when a structured re-ingest tool result is created. Use the exact message `DEV-0000045:T7:reingest_tool_result_built` and include `context` with `callId`, `sourceId`, `status`, `operation`, and `runId`. Purpose: give the final Manual Playwright-MCP check one stable log line that proves Story 45 created the shared nested `tool-result` payload before live publication or persistence.
11. [x] Update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after all file additions or removals in this task are finished. Location: repository root. Description: record every file path added or removed by this task, including the shared re-ingest result builder file created in Subtask 2, the new unit test file [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts), and any removed superseded helper file if an older payload-builder location is replaced. Purpose: keep the repository structure reference accurate after shared runtime files are introduced and make the full file-level impact of this task discoverable.
12. [x] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document the shared re-ingest result payload, wrapper reuse, and persistence path, and add or refresh the Mermaid diagram showing result flow through websocket, inflight, and persisted turn layers using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent runtime contract documentation aligned with the implemented result flow.
13. [x] Update this story file’s Task 7 `Implementation notes` section after the code and tests for this task are complete.
14. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Reviewed `ToolEvent`, `ChatToolResultEvent`, and `Turn.toolCalls`; Task 7 must emit the existing `tool-result` wrapper and persist through the current `{ calls: ChatToolResultEvent[] }` assistant-turn shape without changing the turn schema.
- Added `server/src/chat/reingestToolResult.ts` with the shared nested `reingest_step_result` payload builder and the required T7 log; kept the helper payload-only so no runtime lifecycle or execution wiring leaked into this task.
- Added `server/src/test/unit/reingest-tool-result.test.ts` to cover completed/cancelled/error payloads, live wrapper compatibility, persisted `{ calls: [...] }` compatibility, and distinct `callId` handling within one run.
- Updated `projectStructure.md` to record the new re-ingest result builder and unit test file in both the Story 45 ledger and the standing server inventory sections.
- Updated `design.md` with the Task 7 builder contract and result-flow Mermaid diagram; Context7 Mermaid lookup failed again because the session API key is invalid, so the diagram follows the repo’s existing Mermaid style.
- Ran `npm run lint --workspaces` and `npm run format:check --workspaces`; after fixing the new file import-order warnings, lint returned to the repo’s existing 42-warning baseline and `format:check` passed cleanly.
- `npm run build:summary:server` passed with `warning_count: 0`, so the new re-ingest payload builder and its docs/tests compile cleanly through the wrapper path.
- `npm run test:summary:server:unit` passed with `tests run: 1084` and `failed: 0`, covering the new re-ingest tool-result unit file along with the full server node:test suite.
- `npm run test:summary:server:cucumber` passed with `tests run: 68` and `failed: 0`, confirming the payload-builder-only Task 7 work did not regress the server Cucumber surface.

---

### 8. Add Shared Non-Agent Re-Ingest Turn Lifecycle

- Task Status: `__done__`
- Git Commits:
  - `e644ce3b` - Task 8 implementation: shared non-agent re-ingest lifecycle helper, lifecycle unit coverage, Story 45 Task 8 docs, and final wrapper validation.
  - `b4d9b64a` - Task 8 bookkeeping: recorded the implementation commit in the Task 8 Git Commits ledger after the runtime, tests, and docs were complete.
  - `5b33df58` - Task 8 bookkeeping fix: corrected the Git Commits ledger placement so the Task 8 implementation hash appears under Task 8 instead of Task 1.

#### Overview

Implement the shared non-agent runtime lifecycle that direct commands and dedicated flow steps will use when they need to record re-ingest work without running an LLM turn. This task is only about inflight creation, user/assistant turn lifecycle, tool-event publication, and persistence reuse, which makes it independently testable before re-ingest execution is wired in.

#### Documentation Locations

- Mongoose SchemaTypes documentation: https://mongoosejs.com/docs/schematypes.html - use for confirming that assistant-turn `toolCalls` persistence continues to use the existing mixed schema slot.
- `ws` package documentation: https://github.com/websockets/ws/blob/master/doc/ws.md - use for understanding the underlying WebSocket server behavior that the repo’s publish helpers sit on top of.
- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for any `design.md` diagram updates tied to the shared non-agent lifecycle.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the lifecycle-focused unit tests extended in this task.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- This task is lifecycle reuse only. Do not wire direct command or flow `reingest` execution yet. The goal is one shared non-agent turn lifecycle that can later be called by both direct commands and dedicated flow steps.
- Existing evidence in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) shows the current synthetic flow-step pattern uses `createNoopChat`, `persistFlowTurn(...)`, manual user/assistant turn persistence, and `markInflightPersisted(...)`. Treat that as the extraction source pattern, not as a second lifecycle to copy.
- Existing evidence in [inflightRegistry.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts), [server.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ws/server.ts), and [chatStreamBridge.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/chatStreamBridge.ts) shows the runtime pieces to reuse are `createInflight(...)`, `appendToolEvent(...)`, `publishToolEvent(...)`, `publishUserTurn(...)`, `attachChatStreamBridge(...)`, `markInflightPersisted(...)`, and `markInflightFinal(...)`.
- The shared lifecycle must accept caller-supplied `conversationId`, `modelId`, `source`, and `command` metadata instead of inventing its own model or conversation bootstrap rules. This is required because direct commands and flows reach the lifecycle from different startup paths.
- Do not depend on private flow-only helpers from [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) unless you first move the minimal needed code into an explicitly shared module. The final lifecycle must still emit the Task 7 payload shape and persist it through the existing `Turn.toolCalls` path in [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts).

#### Required Files For This Task

- Read first: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [inflightRegistry.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts), [server.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ws/server.ts), [chatStreamBridge.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/chatStreamBridge.ts), [reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts)
- Create or edit in this task: [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts), [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)

#### Implementation Shape Example

```ts
export async function runReingestStepLifecycle(params: {
  conversationId: string;
  modelId: string;
  command: TurnCommandMetadata;
  toolResult: ChatToolResultEvent;
}): Promise<void> {
  // create inflight, publish user turn, append/publish tool event, persist final assistant turn
}
```

#### Subtasks

1. [x] Read the existing synthetic flow-step lifecycle in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), including `createNoopChat`, `persistFlowTurn`, and manual user/assistant persistence, before extracting or creating any shared helper.
2. [x] Create or update [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts) and export `runReingestStepLifecycle(params)` using the exact helper contract from `Shared Helper File Map`. Base that shared non-agent step emission path on the existing runtime pieces that already exist instead of creating a parallel lifecycle. Reuse:
   - [createInflight()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts);
   - [appendToolEvent()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts) together with [publishToolEvent()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ws/server.ts);
   - [publishUserTurn()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ws/server.ts);
   - [attachChatStreamBridge()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/chatStreamBridge.ts);
   - [markInflightPersisted()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts) and [markInflightFinal()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts);
   - the existing synthetic-turn pattern in [flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) (`createNoopChat`, `persistFlowTurn`, and manual user/assistant persistence) as the source pattern to extract from when a shared helper is needed.
   Extract only the minimal common code required so direct commands and dedicated flow reingest steps share one lifecycle. Require callers to provide the already-resolved `conversationId`, `modelId`, `source`, and `command` metadata that should be published and persisted. Do not import or depend on private flow-only helpers from `flows/service.ts` without first moving them to an explicitly shared module.
3. [x] Keep this task lifecycle-only. Do not yet wire direct command or flow `reingest` execution to call the helper.
4. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for inflight creation before tool-event append/publish and final persistence. Purpose: prove the shared lifecycle initializes runtime state in the correct order.
5. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for user-turn publication. Purpose: prove the shared non-agent lifecycle still emits the expected user-turn event.
6. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for assistant-turn finalization. Purpose: prove the shared non-agent lifecycle still emits the expected assistant-turn completion state.
7. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for `Turn.toolCalls` persistence using the Task 7 payload builder. Purpose: prove the structured re-ingest payload is persisted through the standard turn contract.
8. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for normal outer `Turn.status` handling while the detailed re-ingest outcome remains nested. Purpose: prove outer assistant status and nested re-ingest result status stay distinct in persisted turns.
9. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for normal outer `turn_final.status` handling while the detailed re-ingest outcome remains nested. Purpose: prove websocket final-status reporting stays distinct from nested re-ingest result status.
10. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for memory persistence. Purpose: prove the memory-backed path retains the structured `toolCalls` payload instead of dropping it.
11. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for Mongo persistence. Purpose: prove the persisted assistant turn keeps the same structured `toolCalls` payload in the Mongo-backed path.
12. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for live-event ordering where `tool_event` is published before final assistant-turn completion. Purpose: prove the websocket/inflight lifecycle order matches the intended runtime contract.
13. [x] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for caller-supplied model and command metadata passthrough. Purpose: prove the shared lifecycle does not invent its own model or flow/direct-command metadata when persisting and publishing synthetic turns.
14. [x] Add one observable server log line in [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts) after the shared non-agent lifecycle publishes its tool event and finalizes persistence. Use the exact message `DEV-0000045:T8:reingest_lifecycle_published` and include `context` with `conversationId`, `callId`, `turnId`, `toolEventCount`, and `finalTurnStatus`. Purpose: give the final Manual Playwright-MCP check one stable log line that proves the shared lifecycle emitted and persisted the structured re-ingest result.
15. [x] Update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after all file additions or removals in this task are finished. Location: repository root. Description: record every file path added or removed by this task, including the shared non-agent lifecycle helper created by Subtask 2, the new unit test file [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts), and any removed superseded helper file if lifecycle code is moved out of an older location. Purpose: keep the repository structure reference accurate after shared runtime files are introduced and make the full file-level impact of this task discoverable.
16. [x] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document the shared non-agent re-ingest lifecycle, including inflight creation, tool-event publication, assistant finalization, caller-supplied metadata/model inputs, and persistence, and add or refresh the Mermaid sequence diagram for that lifecycle using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent architecture documentation aligned with the implemented runtime lifecycle.
17. [x] Update this story file’s Task 8 `Implementation notes` section after the code and tests for this task are complete.
18. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read the synthetic flow-step path in `server/src/flows/service.ts` plus the shared inflight, WS, bridge, and Task 7 payload-builder modules to keep the Task 8 extraction aligned with the existing runtime contract.
- Subtasks 2-3: Added `server/src/chat/reingestStepLifecycle.ts` with a shared non-agent lifecycle that reuses inflight creation, WS publication, bridge finalization, and a minimal shared persistence path without wiring any direct-command or flow re-ingest callers yet.
- Subtasks 4-13: Added `server/src/test/unit/reingest-step-lifecycle.test.ts` to cover lifecycle ordering, user-turn publication, assistant finalization, structured `toolCalls` persistence, outer-vs-nested status separation, memory/Mongo paths, live-event ordering, and caller-supplied metadata passthrough.
- Subtask 14: Logged `DEV-0000045:T8:reingest_lifecycle_published` from the shared lifecycle with `conversationId`, `callId`, `turnId`, `toolEventCount`, and `finalTurnStatus` after tool-event publication and assistant-turn finalization.
- Subtask 15: Updated `projectStructure.md` with the new shared lifecycle helper, its unit test file, and the Task 8 structural ledger entry.
- Subtask 16: Updated `design.md` with the shared non-agent lifecycle description and Mermaid sequence; Context7 Mermaid lookup was unavailable because the session API key is invalid, so the diagram follows the repository’s existing Mermaid style.
- Subtask 17: Completed the Task 8 notes after the helper, unit coverage, and doc updates were in place so later tasks can reuse the lifecycle without re-reading the whole flow-service extraction path.
- Subtask 18: `npm run format:check --workspaces` initially failed on the two new Task 8 files, so `npm run format --workspace server` was run and both checks were rerun successfully; `npm run lint --workspaces` returned to the repo’s existing warning-only baseline.
- Testing 1: `npm run build:summary:server` passed with `warning_count: 0` and `agent_action: skip_log`, so the shared lifecycle helper and tests compile cleanly in the full server build.
- Testing 2: A targeted Task 8 wrapper run passed first, then the full `npm run test:summary:server:unit` suite passed with `tests run: 1094`, `failed: 0`, and `agent_action: skip_log`; the wrapper had a long-running but healthy tail during the full suite.
- Testing 3: `npm run test:summary:server:cucumber` passed with `tests run: 68`, `failed: 0`, and `agent_action: skip_log`, so the shared lifecycle changes did not break the existing feature-step coverage.

---

### 9. Support `reingest` Items In Direct Agent Command Runs

- Task Status: `__done__`
- Git Commits:

#### Overview

Teach the direct command runner to execute `reingest` items once, record their structured result, and continue or fail according to Story 45’s direct-command rules. This task is only about direct command `reingest` items and must reuse the shared payload and lifecycle work from Tasks 7 and 8.

#### Documentation Locations

- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the direct-command unit and integration tests that prove `reingest` behavior.
- Mongoose SchemaTypes documentation: https://mongoosejs.com/docs/schematypes.html - use for confirming that direct-command reingest results persist through the existing mixed `toolCalls` slot.
- `ws` package documentation: https://github.com/websockets/ws/blob/master/doc/ws.md - use for understanding the underlying WebSocket server behavior that the repo’s publish helpers sit on top of.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- This task is direct-command `reingest` only. Do not change dedicated flow `reingest` steps here. Reuse the shared payload builder from Task 7 and the shared non-agent lifecycle from Task 8 instead of inventing a direct-command-only persistence path.
- Existing evidence in [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts) shows `runReingestRepository(...)` is the blocking re-ingest source of truth. Reuse its current `sourceId` validation, terminal payload fields, and internal `skipped` -> public `completed` mapping.
- The runtime rule must be repeated here because juniors may read only this task: pre-start failures are fatal to the current command; once the blocking call has been accepted and returns a terminal result, `completed`, `cancelled`, and `error` are all recorded as structured non-fatal step results and the command continues unless a stop/cancel is pending before the next item.
- Existing evidence in [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) shows message items currently run through retry-aware execution. `reingest` items must execute once, without retry prompt injection, and any unexpected thrown exception before a trustworthy terminal result exists must fail the command clearly.
- Existing evidence in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) shows direct commands can start through both `startAgentCommand(...)` and `runAgentCommand(...)`, and only one of those paths pre-creates the conversation/model before command execution begins. This task must make re-ingest work correctly for both entrypoints, including reingest-only commands that have not executed any LLM step yet.

#### Required Files For This Task

- Read first: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts), [reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts), [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts)
- Edit in this task: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts), [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts)

#### Implementation Shape Example

```ts
const outcome = await runReingestRepository({ sourceId: item.sourceId });
const toolResult = buildReingestToolResult({ callId, outcome });
await runReingestStepLifecycle({ conversationId, modelId, command, toolResult });
```

#### Subtasks

1. [x] Read the current direct command step loop and the blocking re-ingest service before wiring `reingest` items into direct command execution.
2. [x] Update the direct-command service/runner contract in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) and [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so reingest-capable command runs have a trustworthy conversation/model bootstrap before any synthetic re-ingest turn is emitted. Cover both `startAgentCommand(...)` and `runAgentCommand(...)`, and ensure reingest-only commands can create or reuse the conversation before the shared non-agent lifecycle runs.
3. [x] Update [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so `reingest` items:
   - execute once and do not participate in AI retry prompt injection;
   - use the exact `sourceId` contract already enforced by [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts);
   - record terminal outcomes through the shared re-ingest result contract from Task 7;
   - normalize any accepted blocking-service `skipped` outcome to the public terminal step status `completed`;
   - continue after terminal `completed`, `cancelled`, or `error` outcomes;
   - observe stop/cancel requests only after the blocking re-ingest call returns and before the next command item starts;
   - fail immediately for pre-start validation/service refusal paths;
   - fail the command clearly if the re-ingest path throws an unexpected exception before a trustworthy terminal result can be recorded.
4. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) proving `reingest` items bypass retry prompt injection. Purpose: prove re-ingest execution stays single-attempt and does not reuse message retry instructions.
5. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a terminal `completed` outcome. Purpose: prove a successful re-ingest result is recorded and the next command item runs.
6. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a terminal `cancelled` outcome. Purpose: prove a cancelled re-ingest result is still recorded as a non-fatal step result.
7. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a terminal `error` outcome. Purpose: prove an accepted terminal error remains non-fatal once the step has started.
8. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for accepted `skipped` outcomes recorded as public `completed`. Purpose: prove the direct-command path keeps the existing status normalization contract.
9. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for stop/cancel during the blocking wait. Purpose: prove the next command item does not start after re-ingest returns when cancellation is pending.
10. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a malformed `sourceId` value. Purpose: prove syntactically invalid re-ingest input fails as a pre-start error before later items begin.
11. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for an unknown `sourceId` value. Purpose: prove well-formed but non-ingested repository paths fail as a pre-start error before later items begin.
12. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for busy/locked pre-start re-ingest rejection. Purpose: prove service-level refusal stops the direct command clearly.
13. [x] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for unexpected thrown exceptions before a trustworthy terminal result exists. Purpose: prove non-contract exceptions fail the command clearly.
14. [x] Add one integration test in [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts) for a reingest-only command started through [runAgentCommand()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) with no pre-existing conversation. Purpose: prove the direct-command re-ingest path can bootstrap a new conversation and persist synthetic turns with a trustworthy model before any LLM step has run.
15. [x] Add one integration test in [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts) for a reingest-only command started through [startAgentCommand()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) with no pre-existing conversation. Purpose: prove the background direct-command entrypoint reuses the same synthetic-turn bootstrap contract as the synchronous entrypoint.
16. [x] Add one integration test in [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts) for a command file that mixes one `reingest` item and one `message` item. Purpose: prove end-to-end execution order across re-ingest and message steps.
17. [x] Add one integration test in [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts) for multiple `reingest` items in one direct command run with distinct `callId` values. Purpose: prove repeated re-ingest results remain distinguishable.
18. [x] Add one integration test in [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts) for a mixed run containing `reingest`, `message.markdownFile`, and `message.content`. Purpose: prove the full mixed-item happy path preserves ordering and non-fatal continuation.
19. [x] Reuse `runReingestStepLifecycle(params)` from [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts) so direct-command `reingest` items produce live `tool_event` updates, inflight snapshots, persisted `toolCalls`, and normal assistant turn finalization without inventing a separate direct-command-only persistence shape.
20. [x] Add one observable server log line in [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) when a direct command records a re-ingest terminal result. Use the exact message `DEV-0000045:T9:direct_command_reingest_recorded` and include `context` with `commandName`, `itemIndex`, `sourceId`, `status`, `callId`, and `continuedToNextItem`. Purpose: give the final Manual Playwright-MCP check one stable log line that proves direct command re-ingest execution reached its structured recording path.
21. [x] Update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after all file additions or removals in this task are finished. Location: repository root. Description: record every file path added or removed by this task, including the direct-command re-ingest integration test file [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts), any permanent fixture directory created for those tests, and any helper file created or removed to support direct-command re-ingest execution. Purpose: keep the repository structure reference accurate for later developers and make the full file-level impact of this task discoverable.
22. [x] Update this story file’s Task 9 `Implementation notes` section after the code and tests for this task are complete.
23. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read `agents/service.ts`, `agents/commandsRunner.ts`, `ingest/reingestService.ts`, `chat/reingestToolResult.ts`, and `chat/reingestStepLifecycle.ts` to anchor Task 9 on the current direct-command bootstrap, blocking re-ingest contract, and shared lifecycle behavior.
- Subtasks 2-3: Added direct-command bootstrap preparation in `agents/service.ts` and a `reingest` execution branch in `commandsRunner.ts` so both `runAgentCommand(...)` and `startAgentCommand(...)` can create or reuse a trustworthy conversation/model before emitting synthetic re-ingest turns.
- Subtasks 4-13: Added focused `agent-commands-runner.test.ts` coverage for single-attempt execution, terminal completed/cancelled/error outcomes, accepted skipped normalization, stop-after-blocking-return behavior, malformed and unknown `sourceId` failures, busy refusals, and unexpected thrown exceptions; one retry assertion needed loosening to match the repo’s real retry prompt wording.
- Subtasks 14-20: Added `commands.reingest.test.ts` integration coverage for both direct-command entrypoints, mixed re-ingest and message ordering, repeated re-ingest call IDs, markdown-plus-inline continuation, shared lifecycle reuse, and the `DEV-0000045:T9:direct_command_reingest_recorded` observability path.
- Subtask 21: Updated `projectStructure.md` with the Task 9 structural ledger and the new `commands.reingest.test.ts` integration entry so the permanent structure doc matches the direct-command re-ingest additions.
- Subtask 23: Ran `npm run lint --workspaces` back to the repo’s 42-warning baseline, then fixed Prettier drift with `npm run format --workspace server` and reran `npm run format:check --workspaces` to green.
- Testing 1: `npm run build:summary:server` passed with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing 2: `npm run test:summary:server:unit` initially exposed an existing command runtime-config log regression after the bootstrap refactor; restoring deterministic T06 error logging in `agents/service.ts` brought the rerun to `tests run: 1109`, `failed: 0`, and `agent_action: skip_log`.
- Testing 3: `npm run test:summary:server:cucumber` passed with `tests run: 68`, `failed: 0`, and `agent_action: skip_log`; a final post-fix lint and format sweep kept the repo at the prior 42-warning lint baseline with Prettier clean.

---

### 10. Support Dedicated Flow `reingest` Steps

- Task Status: `__done__`
- Git Commits:
  - `8cfb8072` - Task 10 checkpoint after dedicated flow `reingest` runtime, metadata, and core integration coverage were implemented.
  - `77eb97f2` - Added the initial Task 10 validation blocker notes after isolating the full-wrapper hang away from the dedicated flow reingest runtime.
  - `33bf7018` - Extended the Task 10 blocker notes with stronger evidence from isolated late-suite validation.
  - `d111fab0` - Refined the blocker handoff toward active-handle and wrapper-exit investigation after the late Codex-backed path.
  - `b2539591` - Finalized Task 10 by fixing the unrelated late-suite MCP test handle leaks and closing the full server-unit wrapper step.

#### Overview

Teach the flow runner to execute dedicated `reingest` steps and to respect Story 45’s pre-start versus post-start outcome rules. This task is only about the flow-level `reingest` step type and must not yet add `reingest` item support inside flow-owned command files.

#### Documentation Locations

- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the flow integration tests that prove dedicated `reingest` step behavior.
- Mongoose SchemaTypes documentation: https://mongoosejs.com/docs/schematypes.html - use for confirming that dedicated flow-step reingest results persist through the existing mixed `toolCalls` slot.
- `ws` package documentation: https://github.com/websockets/ws/blob/master/doc/ws.md - use for understanding the underlying WebSocket server behavior that the repo’s publish helpers sit on top of.
- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for any `design.md` diagram updates tied to dedicated flow re-ingest steps.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- This task is dedicated flow `reingest` steps only. Do not add `reingest` items inside flow-owned command files here. Reuse the shared payload builder from Task 7 and the shared non-agent lifecycle from Task 8.
- Existing evidence in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) shows the flow runner currently assumes agent-oriented startup in places and contains `FALLBACK_MODEL_ID` for non-agent metadata. Flows containing only `reingest` steps must still start successfully by reusing that existing fallback model path instead of inventing a new metadata source.
- Existing evidence in [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts) shows the persisted flow-command schema already treats `agentType` and `identifier` as optional, but the current TypeScript flow metadata builder in [flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) still assumes agent-only flow metadata. This task must update runtime metadata typing so dedicated `reingest` steps persist and publish valid flow step metadata without fake agent values.
- Repeat the runtime rule inside this task: pre-start validation or service-refusal failures stop the flow; once a blocking re-ingest has started and returns a terminal result, `completed`, `cancelled`, and `error` are recorded as structured nested results and are non-fatal to later steps unless a stop/cancel is pending before the next step.
- Existing evidence in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) already covers fatal and validation-style flow failures. Extend that file rather than creating a second unrelated integration test structure.

#### Required Files For This Task

- Read first: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts), [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts), [reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts), [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts)
- Edit in this task: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts), [turn-command-metadata.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/turn-command-metadata.test.ts), [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)

#### Implementation Shape Example

```ts
async function runReingestStep(step: FlowReingestStep): Promise<void> {
  const outcome = await runReingestRepository({ sourceId: step.sourceId });
  const toolResult = buildReingestToolResult({ callId, outcome });
  await runReingestStepLifecycle({ conversationId, modelId, command, toolResult });
}
```

#### Subtasks

1. [x] Read the current flow step dispatcher and the existing flow error tests before adding the dedicated `reingest` step.
2. [x] Update flow startup, metadata, and validation paths in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) and [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts) so flows containing `reingest` steps remain runnable. This includes:
   - allowing `reingest` in any helper or guard that currently assumes only `llm`, `break`, `command`, and `startLoop` exist;
   - supporting flows whose only executable steps are `reingest`;
   - reusing the existing `FALLBACK_MODEL_ID` path already present in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) when no agent-config-derived model is available because the flow contains no agent steps, rather than inventing a new model-resolution source;
   - widening flow command metadata typing so dedicated `reingest` steps can publish and persist `name`, `stepIndex`, `totalSteps`, `loopDepth`, and `label` without requiring `agentType` or `identifier`.
3. [x] Add a dedicated flow `reingest` execution path in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) that calls `runReingestRepository(...)` from [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts), converts the returned terminal outcome with `buildReingestToolResult(...)` from [reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts), and then emits/persists it through `runReingestStepLifecycle(...)` from [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts). That path must:
   - calls the blocking re-ingest service once;
   - records terminal outcomes through the shared re-ingest result contract from Task 7;
   - normalizes any accepted blocking-service `skipped` outcome to the public terminal step status `completed`;
   - continues after terminal `completed`, `cancelled`, or `error` outcomes;
   - fails the current run for pre-start validation/service refusal paths;
   - observes stop/cancel requests only after the blocking re-ingest call returns and before the next flow step starts;
   - fails the current flow clearly if the re-ingest path throws an unexpected exception before a trustworthy terminal result can be recorded;
   - keeps outer run status and nested re-ingest result status distinct.
4. [x] Reuse `runReingestStepLifecycle(params)` from [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts) so dedicated flow `reingest` steps create inflight state, publish `tool_event` updates, and persist assistant turns with populated `toolCalls` instead of the current `toolCalls: null` fallback path used by synthetic failed/stopped flow steps.
5. [x] Add one unit test in [turn-command-metadata.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/turn-command-metadata.test.ts) for a flow command metadata object that has `name: "flow"`, `stepIndex`, `totalSteps`, `loopDepth`, and `label`, but omits `agentType` and `identifier`. Purpose: prove the widened flow metadata contract still round-trips through persistence for non-agent steps.
6. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a post-start terminal `error` outcome. Purpose: prove an accepted terminal error result is recorded but does not stop the rest of the flow.
7. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a post-start terminal `cancelled` outcome. Purpose: prove a cancelled re-ingest result is still recorded as a non-fatal step result.
8. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for accepted `skipped` outcomes recorded as public `completed`. Purpose: prove the dedicated flow-step path keeps the status normalization contract.
9. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a malformed `sourceId` value. Purpose: prove syntactically invalid re-ingest input fails as a pre-start error before later steps begin.
10. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for an unknown `sourceId` value. Purpose: prove well-formed but non-ingested repository paths fail as a pre-start error before later steps begin.
11. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for busy/locked pre-start re-ingest rejection. Purpose: prove service-level refusal stops the flow clearly.
12. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for unexpected thrown exceptions before a trustworthy terminal result exists. Purpose: prove non-contract exceptions fail the current flow.
13. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for stop/cancel during the blocking wait. Purpose: prove the next flow step does not start after re-ingest returns when cancellation is pending.
14. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a timeout result becoming a nested `error` outcome. Purpose: prove timeout handling stays structured and does not crash the run.
15. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a missing-run result becoming a nested `error` outcome. Purpose: prove missing post-launch status stays structured and does not crash the run.
16. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for an unknown terminal result becoming a nested `error` outcome. Purpose: prove unknown terminal states stay structured and do not crash the run.
17. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a flow that contains only `reingest` steps. Purpose: prove reingest-only flows start successfully and use the fallback flow model metadata path.
18. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for persisted and live command metadata on a dedicated `reingest` step. Purpose: prove flow step metadata keeps step counts/label without inventing fake `agentType` or `identifier` values.
19. [x] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for multiple dedicated `reingest` steps targeting the same `sourceId` with distinct `callId` values. Purpose: prove repeated flow-step re-ingest results remain distinguishable.
20. [x] Add one observable server log line in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) when a dedicated flow `reingest` step records its terminal result. Use the exact message `DEV-0000045:T10:flow_reingest_step_recorded` and include `context` with `flowName`, `stepIndex`, `label`, `sourceId`, `status`, `callId`, and `continuedToNextStep`. Purpose: give the final Manual Playwright-MCP check one stable log line that proves the dedicated flow-step re-ingest path reached its structured recording path.
21. [x] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document the dedicated flow `reingest` step, including pre-start fatal failures, post-start non-fatal terminal outcomes, reingest-only flow startup, and non-agent flow-step metadata shape, and add or refresh the Mermaid diagram for this flow-step behavior using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent flow architecture documentation aligned with the implemented dedicated re-ingest step behavior.
22. [x] Update this story file’s Task 10 `Implementation notes` section after the code and tests for this task are complete.
23. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read `flows/service.ts`, `mongo/turn.ts`, `reingestService.ts`, `chat/reingestToolResult.ts`, `chat/reingestStepLifecycle.ts`, `flows.run.errors.test.ts`, and `turn-command-metadata.test.ts` to map the current startup, metadata, and synthetic failure paths before adding dedicated flow `reingest` execution.
- Subtasks 2-4: Updated `flows/service.ts` and `mongo/turn.ts` so dedicated `reingest` steps are runnable flow steps, reuse the fallback flow model when no agent-backed step exists, publish non-agent flow metadata without fake `agentType` or `identifier`, and record accepted terminal outcomes through the shared Task 7/8 tool-result lifecycle while keeping pre-start refusals fatal.
- Subtasks 5-20: Added the non-agent metadata unit coverage plus focused `flows.run.errors.test.ts` integration coverage for terminal `error` and `cancelled` continuation, accepted completed normalization, malformed and unknown `sourceId` failures, busy refusals, thrown exceptions, stop-after-blocking-return behavior, structured timeout/missing/unknown terminal errors, reingest-only flows, live and persisted metadata, repeated call IDs, and the `DEV-0000045:T10:flow_reingest_step_recorded` log; the first targeted run exposed that the synthetic reingest lifecycle publishes an early `turn_final`, so the continuation tests were adjusted to wait on persisted parent turns and to use `MinimalChat` for deterministic follow-up LLM steps.
- Subtask 21: Updated `design.md` with the dedicated flow `reingest` runtime rules, fallback-model startup path, non-agent metadata shape, and Mermaid diagrams for accepted terminal recording versus pre-start fatal failures; Context7 Mermaid lookup failed in this session because the API key is invalid, so the diagrams follow the repo’s existing Mermaid style.
- Subtask 23: `npm run lint --workspaces` returned to the repo’s standing 42-warning import-order baseline after removing one unused helper and fixing the Task 10 import ordering in touched files; `npm run format:check --workspaces` initially failed on `flows.run.errors.test.ts`, so I ran `npm run format --workspace server` and reran Prettier to a clean pass.
- Testing 1: `npm run build:summary:server` passed with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the dedicated flow reingest runtime and metadata changes build cleanly in the full server workspace.
- Subtask 22: Finalized Task 10 after clearing the unrelated late-suite node:test hangs in `mcp-codex-wrapper.test.ts`, `mcp-codebase-question-ws-stream.test.ts`, `mcp-persistence-source.test.ts`, and the `src/test/mcp2/tools/codebaseQuestion.*.test.ts` files by stubbing their LM Studio / Codex probes and replacing ad-hoc `fetch` RPC helpers with one-shot `http.request` calls plus awaited server shutdown.
- Testing 2: `npm run test:summary:server:unit` now completes cleanly end to end with `tests run: 1124`, `passed: 1124`, `failed: 0`, and `agent_action: skip_log`; the final log path was `test-results/server-unit-tests-2026-03-11T07-06-45-326Z.log`.
- Testing 3: `npm run test:summary:server:cucumber` passed with `tests run: 68`, `failed: 0`, and `agent_action: skip_log`, so the dedicated flow reingest path did not regress the existing Cucumber coverage.

---

### 11. Reuse `reingest` Item Execution Inside Flow Command Steps

- Task Status: `__done__`
- Git Commits:

#### Overview

Finish Story 45’s parity work by making flow-owned command files execute `reingest` items through the same single-attempt and structured-result behavior as direct commands. This task is only about `reingest` items inside flow command steps, which keeps the final command-parity work isolated and testable. Keep this narrow as well: reuse the shared command-item execution path, but do not widen the story into a broader retry-model refactor.

#### Documentation Locations

- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the flow-command integration tests that prove `reingest` item parity.
- Mongoose SchemaTypes documentation: https://mongoosejs.com/docs/schematypes.html - use for confirming that flow-command-step reingest results persist through the existing mixed `toolCalls` slot.
- `ws` package documentation: https://github.com/websockets/ws/blob/master/doc/ws.md - use for understanding the underlying WebSocket server behavior that the repo’s publish helpers sit on top of.
- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for any `design.md` diagram updates tied to flow-command re-ingest parity.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose wrapper verification steps that build and start the stack during testing.

#### Critical Task Rules

- This task finishes command-step parity by adding `reingest` item support inside commands that are executed from flows. Reuse the shared command-item path from Task 6 plus the shared payload/lifecycle work from Tasks 7 and 8. Do not widen this into a broader retry-model refactor.
- Existing evidence in [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) shows the direct-command version of this logic will exist after Task 9. Mirror the same step semantics: single attempt only, structured tool-result recording, fatal pre-start failures, non-fatal terminal post-start outcomes.
- Existing evidence in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) shows flow command steps still have their own surrounding orchestration. Preserve that current outer retry behavior while keeping `reingest` items themselves single-attempt.
- Extend the existing command-step integration file [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts), because it already covers repository ordering, load failures, traversal rejection, and stop behavior for flow-owned command execution.

#### Required Files For This Task

- Read first: [commandItemExecutor.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandItemExecutor.ts), [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [reingestToolResult.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestToolResult.ts), [reingestStepLifecycle.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/reingestStepLifecycle.ts)
- Edit in this task: [commandItemExecutor.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandItemExecutor.ts), [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)

#### Implementation Shape Example

```ts
if (item.type === 'reingest') {
  const outcome = await runReingestRepository({ sourceId: item.sourceId });
  const toolResult = buildReingestToolResult({ callId, outcome });
  await runReingestStepLifecycle({ conversationId, modelId, command, toolResult });
}
```

#### Subtasks

1. [x] Compare the direct command `reingest` path from Task 9 with the flow command-item path from Task 6 before making changes.
2. [x] Update `executeCommandItem(params)` in [commandItemExecutor.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandItemExecutor.ts) so flow-owned command files can execute `reingest` items with the same behavior as direct commands:
   - one attempt only;
   - structured `tool-result` recording;
   - pre-start failure handling;
   - continuation after terminal `completed`, `cancelled`, or `error`.
3. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a flow command step whose command file contains `reingest`. Purpose: prove flow-owned commands can execute re-ingest items at all.
4. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for live `tool_event` recording of a flow-command re-ingest result. Purpose: prove the flow-command re-ingest path reuses the current live runtime contract.
5. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for persisted turn-storage recording of a flow-command re-ingest result. Purpose: prove the flow-command re-ingest path reuses the current persisted runtime contract.
6. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for multiple re-ingest results with distinct `callId` values. Purpose: prove repeated flow-command re-ingest results remain distinguishable.
7. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a mixed command file containing `reingest`, `message.markdownFile`, and `message.content`. Purpose: prove mixed-item ordering and non-fatal continuation inside flow-owned command execution.
8. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for stop/cancel during the blocking wait. Purpose: prove later command items or later flow steps do not start after the current re-ingest returns when cancellation is pending.
9. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for surrounding retry behavior with `message` items after the shared executor change. Purpose: prove existing retry behavior for message execution remains intact.
10. [x] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for single-attempt behavior of `reingest` items in the same command file. Purpose: prove re-ingest items do not participate in message retry behavior.
11. [x] Add one observable server log line in [commandItemExecutor.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandItemExecutor.ts) when a flow-owned command step records a re-ingest terminal result. Use the exact message `DEV-0000045:T11:flow_command_reingest_recorded` and include `context` with `flowName`, `stepIndex`, `commandName`, `itemIndex`, `sourceId`, `status`, `callId`, and `continuedToNextItem`. Purpose: give the final Manual Playwright-MCP check one stable log line that proves flow-owned command files reached the final shared re-ingest parity path.
12. [x] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document flow-command re-ingest parity with direct commands, including shared executor boundaries and mixed command-item behavior, and add or refresh the Mermaid diagram for this flow-command path using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent architecture documentation aligned with the final parity design.
13. [x] Update this story file’s Task 11 `Implementation notes` section after the code and tests for this task are complete.
14. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: Re-read `agents/commandItemExecutor.ts`, `agents/commandsRunner.ts`, `flows/service.ts`, `chat/reingestToolResult.ts`, `chat/reingestStepLifecycle.ts`, and `flows.run.command.test.ts`; Task 11 needs to extend the shared executor itself so flow-owned commands mirror Task 9 reingest semantics without moving message retry behavior out of the existing flow-command wrapper.
- Subtasks 2-11: Extended `agents/commandItemExecutor.ts` with a shared `reingest` execution branch plus the `DEV-0000045:T11:flow_command_reingest_recorded` log, updated `flows/service.ts` to reuse the shared Task 7/8 result+lifecycle path for flow-owned command `reingest` items, and added focused `flows.run.command.test.ts` coverage for live/persisted recording, repeated call IDs, mixed ordering, cancellation-after-blocking-return, preserved message retry behavior, and single-attempt `reingest`; the flow-command harness also now resets flow-service deps, log state, and `CODEINFO_CODEX_AGENT_HOME` safely so the new parity tests do not leak into later suites.
- Subtask 12: Updated `design.md` with the final flow-command `reingest` parity notes, executor/lifecycle boundaries, and refreshed Mermaid diagrams; Context7 Mermaid lookup was unavailable in this session because the API key was invalid, so the diagrams follow the repo’s existing Mermaid style.
- Subtasks 13-14: Finished the Task 11 story notes after validation, ran `npm run format --workspace server` to satisfy `format:check`, and tightened two late MCP test helpers so repo-wide lint returned to the existing 42-warning baseline with no errors.
- Testing 1: `npm run build:summary:server` passed with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`; the first reruns caught a few type/test drift issues while Task 11 and the late MCP helpers were still settling.
- Testing 2: Targeted Task 11 wrapper runs drove the flow-command re-ingest fixes first, then the full `npm run test:summary:server:unit` suite passed with `tests run: 1132`, `passed: 1132`, `failed: 0`, and `agent_action: skip_log`; the wrapper had another long but healthy final tail before the success summary.
- Testing 3: `npm run test:summary:server:cucumber` passed with `tests run: 68`, `failed: 0`, and `agent_action: skip_log`, so the final flow-command parity work did not regress the existing feature-step coverage.

---

### 12. Update Documentation And Project Structure For Story 45

- Task Status: `__done__`
- Git Commits:
  - `886034c8` - Task 12 documentation implementation: refreshed `README.md`, `design.md`, and `projectStructure.md` to reflect the final Story 45 command/flow markdown and re-ingest contracts, then completed the required lint/format validation.

#### Overview

Update the permanent documentation after the implementation tasks are complete so the repository explains the new command and flow capabilities accurately. This task is documentation-only and should not introduce new runtime behavior.

#### Documentation Locations

- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for `design.md` diagram updates.
- Mermaid documentation: https://mermaid.js.org/intro/ - use as a secondary reference if Context7 is unavailable when validating `design.md` diagram syntax.
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ - use for the markdown formatting of README and design updates introduced by this story.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for documenting the compose-based validation workflow accurately in permanent repo docs.

#### Critical Task Rules

- This task is documentation-only. Do not introduce runtime behavior changes while updating docs. Re-read the accepted Story 45 contracts in [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md) and document only what the implementation actually does.
- [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) must explain the user-facing file formats and folder expectations, especially `codeinfo_markdown`, direct-command markdown lookup using the existing optional `sourceId` when present, and flow-owned repository-aware fallback lookup.
- [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) must explain the architecture choices: reusing existing websocket events, existing `Turn.toolCalls` persistence, existing blocking `reingestService`, and the fact that Story 45 does not add paused execution, resumable state, or a new protocol surface.
- [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) must list every new helper, test file, and permanent fixture directory introduced by this story so later juniors can discover them quickly.
- This task is documentation-only, so do not add a new runtime log line here. Instead, document the observable Story 45 log messages added in Tasks 1 through 11 so the final Manual Playwright-MCP check has a permanent reference for what each log proves.

#### Required Files For This Task

- Read before editing docs: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md), and the final implemented Story 45 code paths
- Edit in this task: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)

#### Subtasks

1. [x] Update document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md). Location: repository root. Description: add the user-facing explanation for command and flow `reingest`, markdown-backed steps, the `codeinfo_markdown` folder expectations, and direct-command markdown lookup using the existing optional `sourceId` when present. Purpose: give developers and operators one clear entry point for the new Story 45 file formats and usage rules.
2. [x] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document the final command/flow architecture, tool-result contract, repository resolution behavior, reuse of existing websocket and persistence contracts, the absence of paused execution or a new protocol surface, and the observable Story 45 server log messages added in Tasks 1 through 11, and refresh any Mermaid diagrams required to show the final architecture using Context7 Mermaid docs as the primary syntax reference. Purpose: keep the permanent architecture reference aligned with the final Story 45 implementation and give reviewers one place to see what each validation log line proves.
3. [x] Update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Location: repository root. Description: list every new helper file, test file, and permanent fixture directory added by Story 45 in the correct repository sections. Purpose: keep the repository structure reference accurate and discoverable for later developers.
4. [x] Perform one manual documentation sanity read of the changed README, design, and project-structure sections to confirm they describe the final Story 45 behavior consistently and do not contradict the runtime contracts.
5. [x] Update this story file’s Task 12 `Implementation notes` section after the documentation updates are complete.
6. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

No wrapper-based build or test steps are required for this documentation-only task. Do not attempt to run raw tests here.

#### Implementation notes

- Subtask 1: Updated `README.md` with a user-facing Story 45 section covering command and flow file shapes, `codeinfo_markdown`, blocking re-ingest, and the direct-command versus flow-owned markdown lookup rules.
- Subtask 2: Added a final Story 45 architecture reference to `design.md` covering shared markdown resolution, shared re-ingest payload/lifecycle reuse, the no-new-paused-state boundary, and a permanent `DEV-0000045:T1` through `T11` log reference table; Context7 Mermaid lookup was unavailable because the session API key is invalid, so the final diagram follows the repository's existing Mermaid style.
- Subtask 3: Updated `projectStructure.md` with the missing Task 10 and Task 11 ledgers plus a consolidated Story 45 helper/test inventory and a note that Story 45 adds no committed fixture directory under the repository.
- Subtask 4: Manually re-read the changed README, design, and project-structure sections together and confirmed they now describe the same Story 45 contracts for markdown lookup order, structured re-ingest results, and the no-new-protocol/no-paused-state boundary.
- Subtask 5: Recorded the Task 12 implementation notes immediately after the documentation edits so later reviewers can see exactly which permanent docs were refreshed and why.
- Subtask 6: `npm run lint --workspaces` exited cleanly at the repository's existing 42-warning baseline and `npm run format:check --workspaces` passed cleanly, so the final Story 45 documentation updates did not introduce lint or formatting regressions.

---

### 13. Final Validation And Acceptance Check

- Task Status: `__done__`
- Git Commits:
  - `fb1f5194` - Completed the final Story 45 validation pass, manual acceptance evidence, and permanent project-structure note for the PR summary artifact.

#### Overview

Verify the complete story against the acceptance criteria after all earlier tasks are finished. This final task must prove that the finished Story 45 behavior works end to end, that all permanent documentation is current, and that the final PR summary can be written from the completed work.

#### Documentation Locations

- Playwright introduction: https://playwright.dev/docs/intro - use for the manual and automated browser validation flow required in this final task.
- Playwright Docker guidance: https://playwright.dev/docs/docker - use for understanding how browser validation behaves inside the compose-driven environment.
- Cucumber guides: https://cucumber.io/docs/guides/ - use as the required starting point for the cucumber validation run because this task executes the existing cucumber suite and relies on the official guides set for behavior and workflow expectations.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose build/up/down validation sequence required in this final task.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the full server unit validation run that is part of the final acceptance check.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped build and validation commands listed in this task.

#### Critical Task Rules

- This final task must verify the finished story, not add new behavior. If a missing implementation is discovered here, stop final validation, reopen the appropriate earlier task, and complete that implementation there before returning to Task 13.
- Re-check the full acceptance criteria in [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md), including direct-command markdown support, flow `llm.markdownFile`, dedicated/direct/flow-command `reingest`, structured tool-result persistence, deterministic repository ordering, and the no-new-paused-state rule.
- Use the wrapper-first build and test workflow from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md). Do not replace the listed wrappers with raw commands unless wrapper diagnosis is required.
- The manual Playwright check must confirm the server-side Story 45 behavior does not break the current UI. Save screenshots to the exact directory named in this task, because `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local` is mapped in `docker-compose.local.yml`, and review those screenshots as part of acceptance instead of treating capture alone as sufficient evidence.

#### Required Files For This Task

- Read before starting validation: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md), [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), and the full Story 45 acceptance criteria in this file
- Save validation evidence under: [playwright-output-local](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local)

#### Subtasks

1. [x] Re-read the full Story 45 acceptance criteria and confirm every earlier implementation task is marked done before starting this final task.
2. [x] Ensure [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) is fully up to date for Story 45.
3. [x] Ensure [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) is fully up to date for Story 45, including any diagrams added during implementation.
4. [x] Ensure [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) is fully up to date for Story 45.
5. [x] Create a pull-request summary comment covering all Story 45 changes and save or record it in the normal repo workflow location used by the team.
6. [x] Update this story file’s Task 13 `Implementation notes` section after the full validation pass is complete.
7. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run build:summary:client` - Use when client/common code may be affected. Mandatory for final regression checks unless the task is strictly back end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-client-latest.log` to resolve errors.
3. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
4. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.
5. [x] `npm run test:summary:client` - Use when client/common behavior may be affected. Mandatory for final regression checks unless the task is strictly back end. If `failed > 0`, inspect the exact log path printed by the summary (under `test-results/client-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:client -- --file <path>`, `npm run test:summary:client -- --subset "<pattern>"`, and/or `npm run test:summary:client -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:client`.
6. [x] `npm run test:summary:e2e` (allow up to 7 minutes; e.g., `timeout 7m` or set `timeout_ms=420000` in the harness) - If `failed > 0` or setup/teardown fails, inspect `logs/test-summaries/e2e-tests-latest.log`, then diagnose with targeted wrapper commands such as `npm run test:summary:e2e -- --file <path>` and/or `npm run test:summary:e2e -- --grep "<pattern>"`. After fixes, rerun full `npm run test:summary:e2e`.
7. [x] `npm run compose:build:summary` - If status is `failed`, or item counts indicate failures/unknown in a failure run, inspect `logs/test-summaries/compose-build-latest.log` to find the failing target(s).
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP check to manually confirm Story 45 behavior and general regression checks from the front end. This must include confirmation that there are no logged errors in the browser debug console. Use the Playwright MCP tools against `http://host.docker.internal:5001`, open the Logs UI at `/logs`, and do not treat Story 45 as validated until the exact log lines below are visible with the expected outcomes:
   - `DEV-0000045:T1:command_schema_item_parsed` after running a direct command that uses `message.markdownFile` and later a direct command that includes `reingest`. Expected outcome: at least one log row shows `itemType: "message"` with `instructionSource: "markdownFile"` and one shows `itemType: "reingest"`, proving the updated command schema accepted both new item shapes.
   - `DEV-0000045:T2:flow_schema_step_parsed` after running a flow that contains `llm.markdownFile` and a dedicated `reingest` step. Expected outcome: at least one log row shows `stepType: "llm"` with `instructionSource: "markdownFile"` and one shows `stepType: "reingest"`, proving the updated flow schema accepted both new step shapes.
   - `DEV-0000045:T3:markdown_file_resolved` during the direct-command markdown run, the flow `llm.markdownFile` run, and the flow-command markdown run. Expected outcome: log rows show the correct `resolutionScope` and the `resolvedSourceId`/`resolvedPath` values prove same-source lookup or documented fallback order was used.
   - `DEV-0000045:T4:direct_command_markdown_message_loaded` during a direct command that uses `message.markdownFile`. Expected outcome: the log row shows the target `commandName`, `markdownFile`, and a non-zero `instructionLength`, proving the direct-command markdown path produced one instruction string.
   - `DEV-0000045:T5:flow_llm_markdown_loaded` during a flow `llm.markdownFile` run. Expected outcome: the log row shows the target `flowName`, `stepIndex`, and a non-zero `instructionLength`, proving the flow LLM markdown path produced one instruction string.
   - `DEV-0000045:T6:flow_command_message_item_executed` during a flow command step whose command file uses `message.markdownFile`. Expected outcome: the log row shows `instructionSource: "markdownFile"` and the correct `flowName`/`commandName`, proving flow-owned command steps reused the shared message execution path.
   - `DEV-0000045:T7:reingest_tool_result_built` during any direct command, dedicated flow step, or flow command step that performs `reingest`. Expected outcome: the log row shows `callId`, `sourceId`, `status`, and `runId`, proving Story 45 created the shared nested tool-result payload.
   - `DEV-0000045:T8:reingest_lifecycle_published` during any re-ingest run that reaches persistence. Expected outcome: the log row shows `conversationId`, `callId`, `toolEventCount >= 1`, and a final assistant-turn status, proving the shared non-agent lifecycle published and persisted the structured result.
   - `DEV-0000045:T9:direct_command_reingest_recorded` during a direct command that mixes `reingest`, `message.markdownFile`, and `message.content`. Expected outcome: the log row shows the direct command `sourceId`, terminal `status`, and `continuedToNextItem: true` for non-fatal terminal outcomes, proving direct-command re-ingest recording and continuation worked.
   - `DEV-0000045:T10:flow_reingest_step_recorded` during a flow that mixes `llm.markdownFile`, a dedicated `reingest` step, and a later step. Expected outcome: the log row shows the flow `stepIndex`, `status`, and `continuedToNextStep: true` for non-fatal terminal outcomes, proving dedicated flow-step re-ingest recording and continuation worked.
   - `DEV-0000045:T11:flow_command_reingest_recorded` during a flow command step whose command file contains `reingest`. Expected outcome: the log row shows `flowName`, `commandName`, `itemIndex`, `status`, and `continuedToNextItem: true` for non-fatal terminal outcomes, proving flow-owned command files reached final re-ingest parity with direct commands.
   - Take a screenshot of the Logs page after the full Story 45 run has emitted the expected log lines. Expected outcome: the screenshot shows the relevant `DEV-0000045:T1` through `DEV-0000045:T11` rows clearly enough for the agent to verify message text and visible context values, and the page layout remains readable without broken styling or clipped controls.
   - Take screenshots of every GUI state that can confirm Story 45 acceptance from the front end, including the screen used to start the direct command run, the screen used to start the flow run, and the final visible state after each run completes. Expected outcome: the agent can inspect those screenshots and confirm the UI remained stable, showed the expected run surfaces, and did not regress while the new server-side behavior executed.
   - Confirm the browser debug console stays free of unexpected errors during all of the above runs and that the UI remains stable while logs stream in, including the Logs page and the normal command/flow screens.
   - Save screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local/` using names that start with `0000045-task13-`, then review those saved images as part of the acceptance decision. Do not leave screenshot review implicit.
10. [x] `npm run compose:down`

#### Implementation notes

- Subtask 1: Re-read the full Story 45 acceptance criteria plus the completed Task 1 through Task 12 sections and confirmed every earlier implementation task is now marked done before final validation begins.
- Subtasks 2-4: Re-checked `README.md`, `design.md`, and `projectStructure.md` against the live Story 45 contracts and refreshed `projectStructure.md` so the normal PR-summary artifact location now includes `test-results/pr-comments/0000045-summary.md`.
- Subtask 5: Wrote the Story 45 pull-request summary comment to `test-results/pr-comments/0000045-summary.md`, which is the same ignored workflow location already referenced by earlier story ledgers in `projectStructure.md`.
- Testing 1: `npm run build:summary:server` passed with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the final server/common regression build is clean before the larger wrapper suite runs.
- Testing 2: `npm run build:summary:client` passed with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so the final Story 45 validation starts from a clean client typecheck/build baseline too.
- Testing 3: `npm run test:summary:server:unit` passed with `tests run: 1132`, `passed: 1132`, `failed: 0`, and `agent_action: skip_log`; the wrapper still had the branch's familiar long quiet tail, but it completed cleanly without needing log inspection.
- Testing 4: `npm run test:summary:server:cucumber` passed with `tests run: 68`, `passed: 68`, `failed: 0`, and `agent_action: skip_log`, so the server feature-step surface still matches the finished Story 45 runtime.
- Testing 5: `npm run test:summary:client` passed with `tests run: 523`, `passed: 523`, `failed: 0`, and `agent_action: skip_log`, so the final client regression surface is green before e2e and manual browser validation.
- Testing 6: `npm run test:summary:e2e` passed with `tests run: 43`, `passed: 43`, `failed: 0`, and `agent_action: skip_log`, so the compose-backed end-to-end suite stayed green before the explicit manual Story 45 browser run.
- Testing 7: `npm run compose:build:summary` passed with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, so the dedicated manual-validation compose stack built cleanly.
- Testing 8: `npm run compose:up` completed successfully and the validation stack reached healthy `server` plus started `client` containers, so the manual Playwright-MCP acceptance run can target `http://host.docker.internal:5001` as required.
- Subtask 6 / Testing 9: Completed the Manual Playwright-MCP acceptance run against `http://host.docker.internal:5001`, using temporary local-only validation fixtures to drive one direct command plus one flow that exercised direct-command markdown loading, flow `llm.markdownFile`, direct-command re-ingest, dedicated flow re-ingest, and flow-command re-ingest in one pass; the compose stack reads flows from `flows-sandbox/` and did not have `/app/codeinfo_markdown`, so the validation fixtures had to be mirrored into `flows-sandbox/` and seeded into the running server container before the acceptance run could reach the implemented Story 45 paths.
- Subtask 6 / Testing 9: Verified `DEV-0000045:T1` through `DEV-0000045:T11` through the Logs UI plus the `/logs?text=DEV-0000045` server query, confirming schema acceptance, markdown resolution, direct-command markdown execution, flow markdown execution, shared re-ingest payload building, shared re-ingest lifecycle publication, direct-command re-ingest continuation, dedicated flow re-ingest continuation, and flow-command re-ingest continuation with the expected command/flow/sourceId context.
- Subtask 6 / Testing 9: Saved and reviewed the final acceptance screenshots in `playwright-output-local/0000045-task13-agents-start.png`, `playwright-output-local/0000045-task13-agents-complete.png`, `playwright-output-local/0000045-task13-flows-start.png`, `playwright-output-local/0000045-task13-flows-complete.png`, and `playwright-output-local/0000045-task13-logs-markers.png`; the UI stayed stable through the direct command run, flow run, and Logs-page review. Browser-console review found no Story 45-specific regressions, only transient existing `GET /conversations/<id>/turns` 404s immediately after newly accepted runs before the first persisted turn fetch caught up.
- Subtask 7: Re-ran `npm run lint --workspaces` back to the repository's standing 42-warning baseline, then reran `npm run format:check --workspaces` to a clean pass after the final Task 13 edits and screenshot bookkeeping.
- Testing 9: The manual Playwright-MCP acceptance pass succeeded after fixing the compose-only validation setup, and the direct command plus flow transcripts both showed the expected markdown-backed and re-ingest-backed completion states while the Logs page remained readable with the Story 45 marker filter applied.
- Testing 10: `npm run compose:down` completed cleanly and removed the Task 13 validation stack containers plus the `codeinfo2_internal` network, closing the final acceptance environment without lingering compose resources.

---

### 14. Close Review Follow-Up Runtime And Parser Logging Gaps

- Task Status: `__done__`
- Git Commits:

#### Overview

Address the follow-up issues found during Story 45 code review without widening the feature scope. This task covers one runtime correctness fix for background direct-command failures plus two parser-log quality fixes: keep parser logs out of read-only discovery/summary paths, and make the flow-schema parse log step numbering match the 1-based runtime metadata convention.

#### Documentation Locations

- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the unit and integration tests added for the follow-up fixes.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped lint/build/test commands listed in this task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose-aware validation steps when wrappers are rerun.

#### Critical Task Rules

- Fix the background direct-command failure path without inventing a new websocket event type or persistence shape. Reuse the existing user-turn, assistant-turn, inflight, and `turn_final` contract already used elsewhere in the repo.
- Keep Story 45 parser observability available for execution and explicit validation paths, but stop emitting the per-item/per-step T1/T2 info logs from read-only discovery and summary paths.
- The `DEV-0000045:T2:flow_schema_step_parsed` log should use the same 1-based step numbering convention as persisted/runtime flow metadata so the log can be correlated with later runtime evidence.
- Do not reopen the Story 45 runtime contract beyond these review findings.

#### Required Files For This Task

- Read first: [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [agents/commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [agents/commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts), [agents/commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts), [flows/flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts), [flows/discovery.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/discovery.ts)
- Edit in this task: [planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md), [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), [agents/commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts), [agents/commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts), [agents/commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts), [flows/flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts), [flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), [flows/discovery.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/discovery.ts), [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts), [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts), [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts)

#### Subtasks

1. [x] Re-read the reviewed `commandsSchema.ts`, `flowSchema.ts`, `commandsRunner.ts`, and `agents/service.ts` paths plus the related discovery/summary loaders before changing behavior.
2. [x] Update the direct-command background failure path so a `startAgentCommand(...)` run that fails before a normal step lifecycle begins still emits a terminal failure outcome through the existing websocket and persistence contracts instead of only logging the background exception.
3. [x] Cover that background failure fix with integration tests for at least one pre-start `reingest` rejection path and the expected terminal websocket/persistence outcome.
4. [x] Change the Story 45 T1 command-schema parse log so it only emits in explicit execution or validation paths, not during read-only command discovery/summary parsing.
5. [x] Change the Story 45 T2 flow-schema parse log so it only emits in explicit execution or validation paths, not during flow discovery/listing.
6. [x] Update the T2 log context so `stepIndex` is 1-based and matches the runtime/persisted flow step numbering convention.
7. [x] Add unit tests covering the default no-log parser behavior for command and flow schema parsing, plus the explicit opt-in log behavior and the 1-based T2 step numbering.
8. [x] Update this story file’s Task 14 `Implementation notes` section after the fix and tests for this task are complete.
9. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server` - Use when server/common code may be affected. Mandatory for final regression checks unless the task is strictly front end. If status is `failed` or warnings are unexpected/non-zero, inspect `logs/test-summaries/build-server-latest.log` to resolve errors.
2. [x] `npm run test:summary:server:unit` - Use for server node:test unit/integration coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-unit-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:unit -- --file <path>` and/or `npm run test:summary:server:unit -- --test-name "<pattern>"`. After fixes, rerun full `npm run test:summary:server:unit`.
3. [x] `npm run test:summary:server:cucumber` - Use for server Cucumber feature/step coverage when server/common behavior may be affected. Mandatory for final regression checks unless the task is strictly front end. If `failed > 0`, inspect the exact log path printed by the summary (`test-results/server-cucumber-tests-*.log`), then diagnose with targeted wrapper commands such as `npm run test:summary:server:cucumber -- --tags "<expr>"`, `npm run test:summary:server:cucumber -- --feature <path>`, and/or `npm run test:summary:server:cucumber -- --scenario "<pattern>"`. After fixes, rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtasks 1-7: Re-read the reviewed parser, loader, runner, and service paths before patching, then added opt-in parser logging in `commandsSchema.ts`/`flowSchema.ts`, execution-only log enablement in `commandsRunner.ts`/`flows/service.ts`, and a background direct-command failure lifecycle in `agents/service.ts` so rejected `reingest` steps now publish persisted failed turns plus a terminal `turn_final` event instead of only surfacing as a background log.
- Subtasks 3 and 7: Added focused regression coverage in `commands.reingest.test.ts`, `agent-commands-schema.test.ts`, and `flows-schema.test.ts`; the only adjustment needed was subscribing the websocket client before starting the background command so the new terminal failure event could not race the test harness.
- Testing 1 and 3 / Subtask 9: `npm run build:summary:server` passed cleanly, `npm run test:summary:server:cucumber` passed cleanly, `npm run lint --workspaces` returned the repository's standing 42-warning baseline with no new errors, and `npm run format:check --workspaces` passed cleanly.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with 1137 tests run and 0 failures after the follow-up fixes, so Task 14 now has full wrapper coverage across the required server build, node:test, and cucumber paths.

---

### 15. Re-Validate Story 45 After Review Fixes

- Task Status: `__done__`
- Git Commits: `64dc2dd9`, `76c74715`, `369aedf4`

#### Overview

Re-run the full Story 45 acceptance validation after the review-driven fixes are complete. This task exists so the reopened work forces a complete story re-check rather than relying only on targeted regression tests.

#### Documentation Locations

- Playwright introduction: https://playwright.dev/docs/intro - use for the manual browser validation flow required in this final follow-up task.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for the compose build/up/down validation sequence required in this task.
- Node.js test runner documentation: https://nodejs.org/api/test.html - use for the full server unit validation run that is part of this acceptance re-check.
- npm workspaces documentation: https://docs.npmjs.com/cli/v11/using-npm/workspaces - use for the workspace-scoped build and validation commands listed in this task.

#### Critical Task Rules

- This task must verify the reopened Story 45 work, not add new behavior. If another issue is discovered here, stop final validation, reopen the appropriate earlier follow-up task, and complete that implementation there before returning to this task.
- Re-check the full Story 45 acceptance criteria, including the review-fix expectations for background direct-command terminal failure handling and the reduced parser-log noise in read-only paths.
- Use the wrapper-first build and test workflow from [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md). Do not replace the listed wrappers with raw commands unless wrapper diagnosis is required.

#### Required Files For This Task

- Read before starting validation: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md), [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md), [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md), [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md), and the full Story 45 acceptance criteria in this file
- Save validation evidence under: [playwright-output-local](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/playwright-output-local)

#### Subtasks

1. [x] Re-read the full Story 45 acceptance criteria and confirm Task 14 is marked done before starting this validation rerun.
2. [x] Re-run the full wrapper validation for the reopened Story 45 scope and confirm the full server suite still completes cleanly.
3. [x] Re-check the manual acceptance evidence needed for Story 45, including the direct-command rejection/failure behavior addressed by the review fix.
4. [x] Update this story file’s Task 15 `Implementation notes` section after the full validation rerun is complete.
5. [x] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, rerun with available fix scripts (e.g., `npm run lint:fix`/`npm run format --workspaces`) and manually resolve remaining issues.

#### Testing

Use only the summary wrappers listed below. Do not attempt to run builds or tests without a wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts.

1. [x] `npm run build:summary:server`
2. [x] `npm run test:summary:server:unit`
3. [x] `npm run test:summary:server:cucumber`
4. [x] `npm run build:summary:client`
5. [x] `npm run test:summary:client`
6. [x] `npm run test:summary:e2e`
7. [x] `npm run compose:build:summary`
8. [x] `npm run compose:up`
9. [x] Manual Playwright-MCP acceptance rerun
10. [x] `npm run compose:down`

#### Implementation notes

- Subtasks 1-5: Re-read the full Story 45 acceptance criteria plus the Task 14 follow-up rules before rerunning validation, then completed the full wrapper validation sweep and final lint/format checks without reopening any earlier implementation tasks.
- Testing 1-7: `npm run build:summary:server`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `npm run build:summary:client`, `npm run test:summary:client`, `npm run test:summary:e2e`, and `npm run compose:build:summary` all passed cleanly during the Task 15 rerun; the wrapper evidence was `1137` server unit tests passed with `0` failures, `68` server cucumber tests passed with `0` failures, and `523` client tests passed with `0` failures.
- Testing 8-9 / Subtask 3: `npm run compose:up` brought the validation stack up cleanly, and the manual Playwright-MCP rerun confirmed that read-only `/agents`, `/flows`, and `/logs` browsing did not emit Story 45 T1/T2 parser logs before execution, while an invalid direct-command `reingest` run failed visibly in the UI with `sourceId must match an existing ingested repository root exactly` instead of hanging after the background `202` start response.
- Testing 9 / Subtask 3: Saved browser evidence under `playwright-output-local`, including `0000045-task15-logs-no-noise.png`, `0000045-task15-agents-start.png`, `0000045-task15-agents-complete.png`, and `0000045-task15-flows-start.png`; the only browser-console issue observed during the rerun was the same transient `404` for `/conversations/<id>/turns`, so no new Story 45 regression was identified.
- Testing 10: `npm run compose:down` completed cleanly after the manual acceptance rerun, and the temporary local-only validation fixtures created for Task 15 (`codex_agents/coding_agent/commands/0000045_task15_reingest_rejection.json` and `flows-sandbox/0000045_task15_parser_gate.json`) were used only for acceptance evidence and should not be committed with the story ledger.
