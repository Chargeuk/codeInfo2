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

Current repository evidence shows that direct command runs do not currently carry a repository `sourceId` the way flows do. To keep this story small and aligned with the existing runner contracts, direct command execution resolves `markdownFile` from the codeInfo2 repository only. Repository-aware command markdown fallback is supported when a command is executed from inside a flow, because the flow already owns the repository context and deterministic repository ordering.

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

For direct command execution outside a flow, codeInfo2 is the only repository root consulted. For flow-owned command execution, the same-source and codeInfo2 roots may collapse to the same checkout when the flow itself is running from codeInfo2.

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

### Runtime Message And Storage Contracts

This story does not need new top-level websocket event types, a new websocket protocol version, a new Mongo collection, or a new top-level conversation storage object. The current repository already has reusable structures for command metadata, mixed tool-call payloads, timing metadata, and conversation flags.

Contracts that remain unchanged:

- `server/src/mongo/turn.ts`
  - `Turn.status` stays `ok | stopped | failed`.
  - `Turn.command` remains the existing command/flow metadata object.
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
- Direct command execution without a flow-owned repository context resolves `markdownFile` from the codeInfo2 repository only.
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
- Direct command repository scope: direct command runs do not have a flow-owned repository context, so `markdownFile` lookup stays codeInfo2-only even if another ingested repository also contains a matching file.
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
- Adding a new direct-command REST or MCP contract that supplies repository `sourceId` just to support cross-repository markdown lookup.
- Free-form filesystem-relative markdown lookup outside of `codeinfo_markdown`.
- Adding a second command-only LLM step type when the existing command `message` item already covers that responsibility.
- Expanding markdown files into multiple message objects, frontmatter-driven prompt behavior, or any other markdown prompt DSL.
- Automatic retries that start a second re-ingest run after a terminal re-ingest result.
- Replacing existing flow command-resolution behavior with a new global resolver order beyond the markdown resolution needed by this story.
- Adding new command or flow step types unrelated to re-ingest or markdown-backed `llm`.
- Changing agent instruction semantics outside of what is required to pass verbatim markdown content.

### Questions

None. The command-file compatibility and markdown-path decisions are now fixed for this story.

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

- Add one shared markdown resolver helper in the server codebase, ideally near the existing flow repository-resolution logic, for example `server/src/flows/markdownResolver.ts`.
- That helper should:
  - validate that `markdownFile` is a safe relative path under `codeinfo_markdown`;
  - reject empty paths, absolute paths, `..` traversal, and any normalized path that escapes the root;
  - build candidate repositories using the existing deterministic ordering already present in `server/src/flows/service.ts`;
  - continue on missing files only;
  - fail immediately once a candidate file exists but cannot be read or decoded;
  - read bytes and decode with strict UTF-8 handling so invalid bytes fail clearly;
  - return the exact file text without trimming, newline rewriting, or markdown-specific preprocessing.
- Repository context should be threaded into this helper only where that context already exists:
  - direct command runs use codeInfo2 only;
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
  - direct-command codeInfo2 resolution;
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

# Tasks

### 1. Add Command Schema Support For `markdownFile` And `reingest`

- Task Status: `__to_do__`
- Git Commits:

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

#### Subtasks

1. [ ] Read the Story 45 command contract, then read the existing command schema file and command schema tests before making any edits. Confirm exactly where `message` items are currently defined and how command files are validated.
2. [ ] Update [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts) so command `items` become a discriminated union that supports:
   - `message` items with exactly one of `content` or `markdownFile`;
   - `reingest` items with `sourceId`;
   - the existing top-level `{ Description, items }` contract with no renaming.
3. [ ] Update command-side type aliases and schema consumers that currently assume command items always expose `content`. At minimum, inspect and fix affected TypeScript narrowing in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) and [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so the command schema expansion compiles cleanly before runtime work begins.
4. [ ] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the happy path where a `message` item uses `content`. Purpose: prove the existing inline-content command contract still parses after the schema change.
5. [ ] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the happy path where a `message` item uses `markdownFile`. Purpose: prove the new markdown-backed command message shape is accepted.
6. [ ] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the happy path where an item uses `{ "type": "reingest", "sourceId": "..." }`. Purpose: prove the new command re-ingest item shape is accepted.
7. [ ] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for invalid `message.markdownFile: ""`. Purpose: prove empty-string markdown references are rejected instead of being treated as missing or valid.
8. [ ] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the XOR error case where `content` and `markdownFile` are both present. Purpose: prove the parser rejects command messages with two instruction sources.
9. [ ] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for the XOR error case where `content` and `markdownFile` are both absent. Purpose: prove the parser rejects command messages with no instruction source.
10. [ ] Add one unit test in [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) for strict-schema rejection of unknown keys, including an unexpected extra key on a `reingest` item. Purpose: prove the parser remains strict for the new item shapes.
11. [ ] Update this story file’s Task 1 `Implementation notes` section after the code and tests for this task are complete.
12. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server` - required because this task changes server TypeScript schemas and parser logic.
2. [ ] `npm run build:summary:client` - required because server contract type changes can still reveal shared-package or workspace regressions.
3. [ ] `npm run compose:build:summary` - required to prove the updated schema code still builds in the containerized path.
4. [ ] `npm run compose:up` - required so later tasks inherit a known-good stack after the schema change.
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-schema.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 2. Add Flow Schema Support For `markdownFile` And `reingest`

- Task Status: `__to_do__`
- Git Commits:

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

#### Subtasks

1. [ ] Read the Story 45 flow contract, then read the existing flow schema file and flow schema tests before making any edits. Confirm exactly where `llm`, `command`, `break`, `startLoop`, and the discriminated union are currently defined.
2. [ ] Update [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts) so the flow step union supports:
   - `llm` steps with exactly one of `messages` or `markdownFile`;
   - `reingest` steps with `sourceId` and optional `label`;
   - unchanged `command`, `break`, and `startLoop` steps.
3. [ ] Update flow-side type aliases and schema consumers that currently assume flow steps only include the existing four step types. At minimum, inspect and fix affected TypeScript narrowing in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) so the expanded step union compiles cleanly before runtime work begins.
4. [ ] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the happy path where an `llm` step uses `messages`. Purpose: prove the existing flow LLM contract still parses after schema expansion.
5. [ ] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the happy path where an `llm` step uses `markdownFile`. Purpose: prove the new markdown-backed flow LLM step shape is accepted.
6. [ ] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the happy path where a step uses `{ "type": "reingest", "sourceId": "..." }`. Purpose: prove the new flow re-ingest step shape is accepted.
7. [ ] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for a flow whose executable steps are all `reingest`. Purpose: prove schema validation allows reingest-only flows before runtime work starts.
8. [ ] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for invalid `llm.markdownFile: ""`. Purpose: prove empty-string markdown references are rejected instead of being treated as missing or valid.
9. [ ] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the XOR error case where `messages` and `markdownFile` are both present. Purpose: prove the parser rejects flow LLM steps with two instruction sources.
10. [ ] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for the XOR error case where `messages` and `markdownFile` are both absent. Purpose: prove the parser rejects flow LLM steps with no instruction source.
11. [ ] Add one unit test in [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) for strict-schema rejection of unknown keys, including an unexpected extra key on a `reingest` step. Purpose: prove the parser remains strict for the new flow step shapes.
12. [ ] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: add the final Story 45 flow-file contract for `llm.markdownFile` and the dedicated `reingest` step shape, and add or refresh Mermaid diagrams that show those step variants using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent architecture/design reference aligned with the supported flow schema.
13. [ ] Update this story file’s Task 2 `Implementation notes` section after the code and tests for this task are complete.
14. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server` - required because this task changes server TypeScript schemas and parser logic.
2. [ ] `npm run build:summary:client` - required because server contract type changes can still reveal shared-package or workspace regressions.
3. [ ] `npm run compose:build:summary` - required to prove the updated schema code still builds in the containerized path.
4. [ ] `npm run compose:up` - required so later tasks inherit a known-good stack after the schema change.
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/flows-schema.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 3. Add The Shared Markdown Resolver And Its Safety Rules

- Task Status: `__to_do__`
- Git Commits:

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
- Direct command runs use codeInfo2 only. Flow `llm` steps and flow-owned command steps may use same-source plus fallback ordering. This distinction must be enforced by the shared resolver instead of by scattered call-site logic.
- Existing evidence in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) shows the repository ordering logic already exists there. Reuse that logic or extract it cleanly; do not invent a second ordering algorithm. Keep decoding strict by reading bytes first and decoding with a fatal UTF-8 path documented at https://nodejs.org/api/util.html#class-utiltextdecoder.

#### Subtasks

1. [ ] Read the Story 45 markdown-resolution contract and the existing flow repository-ordering helpers in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) before creating any new helper.
2. [ ] Add one shared resolver module in the server codebase, preferably near the existing flow repository-ordering code, that:
   - validates safe relative `markdownFile` paths under `codeinfo_markdown`;
   - rejects empty values, absolute paths, and traversal/escape attempts;
   - builds candidate repositories in the documented same-source, codeInfo2, other-repos order;
   - continues on missing files only;
   - fails immediately when a higher-priority candidate contains the file but it cannot be read or decoded.
3. [ ] Implement strict UTF-8 decoding in that resolver using a byte-first Node path rather than permissive string reads. Read raw bytes first, then decode with a strict decoder (`TextDecoder` with `fatal: true` or an equivalent strict Buffer-based path) so invalid bytes fail clearly instead of being silently replaced.
4. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for direct-command codeInfo2-only lookup. Purpose: prove direct command runs resolve markdown from the codeInfo2 repository without consulting other sources.
5. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for same-source flow lookup. Purpose: prove flow-owned markdown resolution prefers the parent flow repository first.
6. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for codeInfo2 fallback after same-source miss. Purpose: prove the documented fallback order is used.
7. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for deterministic other-repository fallback. Purpose: prove fallback reaches non-codeInfo2 repositories only after the higher-priority candidates miss.
8. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for a valid root-level markdown lookup such as `file.md`. Purpose: prove files directly inside `codeinfo_markdown` are accepted.
9. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for a valid nested-subpath lookup such as `subdir/file.md`. Purpose: prove safe nested paths are accepted when they stay inside `codeinfo_markdown`.
10. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for valid UTF-8 markdown containing non-ASCII characters that is returned verbatim. Purpose: prove strict decoding still preserves valid Unicode content unchanged.
11. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for deterministic tie-breaking when fallback repositories share the same case-insensitive source label. Purpose: prove path ordering is used as the stable final tie-breaker.
12. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for the all-candidates-missing error path. Purpose: prove the resolver fails clearly instead of returning an empty instruction.
13. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for a higher-priority unreadable file. Purpose: prove unreadable content blocks fallback instead of being silently skipped.
14. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for an explicit permission/read error such as `EACCES` or `EPERM`. Purpose: prove permission failures are surfaced clearly as fail-fast resolver errors.
15. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for invalid UTF-8 failure. Purpose: prove strict decoding rejects invalid bytes instead of replacing them silently.
16. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for empty-path rejection. Purpose: prove blank markdown paths are rejected before any file read occurs.
17. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for absolute-path rejection. Purpose: prove absolute markdown paths cannot escape the repository contract.
18. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for `..` traversal rejection. Purpose: prove parent-directory traversal is blocked before candidate resolution begins.
19. [ ] Add one unit test in [markdown-file-resolver.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/markdown-file-resolver.test.ts) for normalized escape-attempt rejection. Purpose: prove paths that normalize outside `codeinfo_markdown` are still rejected.
20. [ ] If this task adds a new resolver file or test file, update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Location: repository root. Description: list each new resolver or test file added by this task under the correct server path section. Purpose: keep the repository structure reference accurate for later developers.
21. [ ] Update this story file’s Task 3 `Implementation notes` section after the code and tests for this task are complete.
22. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/markdown-file-resolver.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 4. Support `message.markdownFile` In Direct Agent Command Runs

- Task Status: `__to_do__`
- Git Commits:

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
- Inline `content` keeps the current `content.join('\\n')` behavior. `markdownFile` must load exactly one markdown file through the shared resolver from Task 3 and pass the markdown through verbatim as one instruction string. For direct commands outside a flow, the resolver scope is codeInfo2-only.
- Startup metadata also needs protection in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts), because the current command-start code inspects early items. Keep this simple: do not resolve markdown just to generate a prettier title. A generic fallback title is acceptable when the first item has no inline `content`.

#### Subtasks

1. [ ] Read [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) and the existing runner tests before changing direct command execution.
2. [ ] Update the direct command runner so `message` items:
   - keep the current `content.join('\n')` behavior when `content` is used;
   - resolve one markdown file into one instruction string when `markdownFile` is used;
   - use codeInfo2-only repository scope for direct commands that are not running inside a flow.
3. [ ] Keep the existing retry path for message-based agent instruction execution. This task must not add `reingest` execution yet and must not change retry-prompt behavior for `message` items.
4. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for the happy path where one direct command item uses `message.markdownFile`. Purpose: prove the runner loads one markdown instruction and executes it once.
5. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) proving the loaded markdown is passed through verbatim. Purpose: prove the runner does not trim, split, or rewrite markdown content before sending it to the agent.
6. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for multiple `message.markdownFile` items in one direct command run. Purpose: prove each markdown item becomes its own instruction and execution order is preserved.
7. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a direct command that mixes `message.markdownFile` and `message.content`. Purpose: prove inline-content behavior stays unchanged when mixed with markdown-backed items.
8. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for the error path where a markdown file is missing. Purpose: prove direct command execution fails clearly instead of silently continuing with empty content.
9. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for the error path where a markdown file is undecodable. Purpose: prove invalid markdown bytes surface as a clear command failure.
10. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for an unexpected resolver exception. Purpose: prove unexpected markdown-loader failures surface as clear command errors.
11. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for the existing inline `content` path after the markdown change. Purpose: prove the original direct-command message behavior remains intact.
12. [ ] Update direct-command startup metadata paths in [agents/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/service.ts) so command title generation, first-step inspection, and any pre-run assumptions remain safe when the first command item uses `markdownFile` or `reingest` instead of `content`. Keep this intentionally simple: do not resolve markdown files at command-start time just to improve the title; a generic `Command: <name>` fallback is acceptable when no inline content exists yet.
13. [ ] If this task adds a new direct-command markdown integration test file such as [commands.markdown-file.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.markdown-file.test.ts), or adds any permanent fixture directory or helper file, update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Location: repository root. Description: record each new test file, helper file, or permanent fixture directory created for direct-command markdown execution. Purpose: keep the repository structure reference accurate for later developers.
14. [ ] Update this story file’s Task 4 `Implementation notes` section after the code and tests for this task are complete.
15. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-runner.test.ts`
6. [ ] Add or update one integration test for direct command markdown execution, then run `npm run test:summary:server:unit -- --file server/src/test/integration/commands.markdown-file.test.ts`
7. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 5. Support `llm.markdownFile` In Flow Steps

- Task Status: `__to_do__`
- Git Commits:

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

#### Subtasks

1. [ ] Read the current `runLlmStep(...)` path in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) and the existing flow execution tests before making changes.
2. [ ] Update the flow runner so an `llm` step with `markdownFile` resolves exactly one markdown file into one instruction string and executes it once through the existing agent-turn path.
3. [ ] Keep the current `messages` array behavior unchanged for existing flow `llm` steps, including current retry behavior and current turn persistence for successful and failed agent turns.
4. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for same-source markdown resolution in an `llm.markdownFile` step. Purpose: prove the parent flow repository is the first lookup candidate.
5. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) proving loaded markdown is passed through verbatim as one instruction string. Purpose: prove flow `llm` markdown content is not rewritten before execution.
6. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for fallback to codeInfo2 after a same-source miss. Purpose: prove the first fallback candidate in the documented repository order is applied correctly.
7. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for fallback to another ingested repository after same-source and codeInfo2 misses. Purpose: prove the final fallback tier in the documented repository order is applied correctly.
8. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for a higher-priority unreadable markdown file. Purpose: prove flow execution fails fast instead of falling through to a lower-priority repository.
9. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for duplicate-label fallback ordering. Purpose: prove same-label repositories still resolve deterministically by full path.
10. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for a missing markdown file. Purpose: prove flow execution fails clearly instead of producing an empty instruction.
11. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for an undecodable markdown file. Purpose: prove invalid markdown bytes surface as a clear flow-step failure.
12. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) for an unexpected markdown-resolver exception. Purpose: prove unexpected loader failures surface as clear flow-step errors.
13. [ ] Add one integration test in [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) where a successful `llm.markdownFile` step is followed by a later step. Purpose: prove the happy-path flow sequence continues after markdown execution.
14. [ ] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document flow `llm.markdownFile` execution, repository fallback ordering, and the one-instruction execution path, and add or refresh the Mermaid diagram for this flow-step behavior using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent flow architecture documentation aligned with the implemented runtime behavior.
15. [ ] Update this story file’s Task 5 `Implementation notes` section after the code and tests for this task are complete.
16. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 6. Reuse Command `message` Item Execution Inside Flow Command Steps

- Task Status: `__to_do__`
- Git Commits:

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

#### Subtasks

1. [ ] Read the current flow command-step execution loop in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) and compare it to the direct command path in [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts).
2. [ ] Do not call [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) directly from flow execution. Instead, extract a shared command-item execution helper that both call sites can use while preserving their different lock ownership and outer step orchestration responsibilities.
3. [ ] Keep the existing outer retry behavior on each caller unchanged unless implementation proves otherwise:
   - direct commands continue to use the current `commandsRunner.ts` retry path;
   - flow command steps continue to use their current outer flow-step retry path;
   - the shared helper should focus on message-item instruction preparation and execution dispatch, not on rewriting the surrounding retry model.
4. [ ] Make that shared command-item execution helper handle the shared `message`-item behavior for:
   - `content` items;
   - `markdownFile` items;
   - repository-context-aware resolution when a command is executed from inside a flow.
5. [ ] Keep this task focused on `message` items only. Do not add `reingest` item execution in this task.
6. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a flow command step whose command file contains one `message.markdownFile` item. Purpose: prove flow-owned commands can execute markdown-backed message items at all.
7. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for multiple `message.markdownFile` items in one flow-owned command file. Purpose: prove item ordering and repeated markdown resolution both work.
8. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a command file that mixes `message.markdownFile` and `message.content`. Purpose: prove inline-content behavior remains unchanged inside flow-owned command execution.
9. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for same-source repository context use. Purpose: prove flow-owned commands check the parent flow repository before fallback candidates.
10. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for fallback repository context use after a same-source miss. Purpose: prove flow-owned commands follow the documented repository fallback order.
11. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a higher-priority unreadable markdown file. Purpose: prove the command step fails fast instead of silently falling through.
12. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) comparing message-item resolution and execution behavior with the direct-command path. Purpose: prove the shared helper does not drift from direct-command semantics.
13. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for surrounding retry behavior after the shared-helper refactor. Purpose: prove the flow command-step retry model and direct-command retry model remain unchanged where they already existed.
14. [ ] If this task introduces a shared command-item execution module, update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Location: repository root. Description: add the new shared command-item execution module path, plus any new companion test files created for this task. Purpose: keep the repository structure reference accurate after shared execution code is introduced.
15. [ ] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: explain the shared command-item execution path used by direct commands and flow command steps, and add or refresh the Mermaid diagram for this shared flow-command path using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent architecture documentation aligned with the intended shared execution design.
16. [ ] Update this story file’s Task 6 `Implementation notes` section after the code and tests for this task are complete.
17. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 7. Add Shared Re-Ingest Result Payload Builder

- Task Status: `__to_do__`
- Git Commits:

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

#### Subtasks

1. [ ] Read the current `ToolEvent`, `ChatToolResultEvent`, and `Turn.toolCalls` shapes before adding any new payload builder.
2. [ ] Add one shared re-ingest result builder or equivalent shared path that:
   - converts a terminal re-ingest outcome into the nested `reingest_step_result` payload;
   - wraps it in the existing `tool-result` shape for live events and persisted tool calls;
   - reuses the existing `tool_event`, `inflight_snapshot.inflight.toolEvents`, and `Turn.toolCalls` contracts instead of introducing a new websocket event type, new top-level conversation flag, or new persisted collection;
   - keeps the existing Mongoose turn schema untouched because [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts) already stores `toolCalls` as `Schema.Types.Mixed`;
   - includes a stable `callId`;
   - preserves distinct `callId` values when multiple re-ingest results are recorded in one run.
3. [ ] Keep this task payload-only. Do not yet add inflight creation, synthetic user turns, assistant turn finalization, or direct/flow re-ingest execution wiring.
4. [ ] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for a terminal `completed` re-ingest outcome. Purpose: prove the builder creates the expected nested payload and outer success wrapper for the normal happy path.
5. [ ] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for a terminal `cancelled` re-ingest outcome. Purpose: prove cancellation is preserved as structured data without changing the wrapper contract.
6. [ ] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for a terminal `error` re-ingest outcome. Purpose: prove error results keep the expected payload fields and stage mapping.
7. [ ] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for compatibility with the existing live `tool-result` event shape. Purpose: prove Story 45 reuses the current websocket wrapper contract instead of inventing a new one.
8. [ ] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for compatibility with the persisted `Turn.toolCalls` shape. Purpose: prove Story 45 reuses the current persisted wrapper contract instead of inventing a new one.
9. [ ] Add one unit test in [reingest-tool-result.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-tool-result.test.ts) for multiple results with distinct `callId` values. Purpose: prove separate re-ingest events remain distinguishable within one run.
10. [ ] If this task adds a new shared helper file or test file, update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Location: repository root. Description: add the new shared re-ingest helper path and any new test files created for the shared result builder work. Purpose: keep the repository structure reference accurate after shared runtime files are introduced.
11. [ ] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document the shared re-ingest result payload, wrapper reuse, and persistence path, and add or refresh the Mermaid diagram showing result flow through websocket, inflight, and persisted turn layers using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent runtime contract documentation aligned with the implemented result flow.
12. [ ] Update this story file’s Task 7 `Implementation notes` section after the code and tests for this task are complete.
13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/reingest-tool-result.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 8. Add Shared Non-Agent Re-Ingest Turn Lifecycle

- Task Status: `__to_do__`
- Git Commits:

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
- Do not depend on private flow-only helpers from [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) unless you first move the minimal needed code into an explicitly shared module. The final lifecycle must still emit the Task 7 payload shape and persist it through the existing `Turn.toolCalls` path in [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts).

#### Subtasks

1. [ ] Read the existing synthetic flow-step lifecycle in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts), including `createNoopChat`, `persistFlowTurn`, and manual user/assistant persistence, before extracting or creating any shared helper.
2. [ ] Base the shared non-agent step emission path on the existing runtime pieces that already exist instead of creating a parallel lifecycle. Reuse:
   - [createInflight()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts);
   - [appendToolEvent()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts) together with [publishToolEvent()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ws/server.ts);
   - [publishUserTurn()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ws/server.ts);
   - [attachChatStreamBridge()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/chatStreamBridge.ts);
   - [markInflightPersisted()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts) and [markInflightFinal()](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts);
   - the existing synthetic-turn pattern in [flows/service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) (`createNoopChat`, `persistFlowTurn`, and manual user/assistant persistence) as the source pattern to extract from when a shared helper is needed.
   Extract only the minimal common code required so direct commands and dedicated flow reingest steps share one lifecycle. Do not import or depend on private flow-only helpers from `flows/service.ts` without first moving them to an explicitly shared module.
3. [ ] Keep this task lifecycle-only. Do not yet wire direct command or flow `reingest` execution to call the helper.
4. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for inflight creation before tool-event append/publish and final persistence. Purpose: prove the shared lifecycle initializes runtime state in the correct order.
5. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for user-turn publication. Purpose: prove the shared non-agent lifecycle still emits the expected user-turn event.
6. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for assistant-turn finalization. Purpose: prove the shared non-agent lifecycle still emits the expected assistant-turn completion state.
7. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for `Turn.toolCalls` persistence using the Task 7 payload builder. Purpose: prove the structured re-ingest payload is persisted through the standard turn contract.
8. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for normal outer `Turn.status` handling while the detailed re-ingest outcome remains nested. Purpose: prove outer assistant status and nested re-ingest result status stay distinct in persisted turns.
9. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for normal outer `turn_final.status` handling while the detailed re-ingest outcome remains nested. Purpose: prove websocket final-status reporting stays distinct from nested re-ingest result status.
10. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for memory persistence. Purpose: prove the memory-backed path retains the structured `toolCalls` payload instead of dropping it.
11. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for Mongo persistence. Purpose: prove the persisted assistant turn keeps the same structured `toolCalls` payload in the Mongo-backed path.
12. [ ] Add one unit test in [reingest-step-lifecycle.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingest-step-lifecycle.test.ts) for live-event ordering where `tool_event` is published before final assistant-turn completion. Purpose: prove the websocket/inflight lifecycle order matches the intended runtime contract.
13. [ ] If this task adds a new shared helper file or test file, update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Location: repository root. Description: add the new shared non-agent lifecycle helper path and any new test files created for this lifecycle work. Purpose: keep the repository structure reference accurate after shared runtime files are introduced.
14. [ ] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document the shared non-agent re-ingest lifecycle, including inflight creation, tool-event publication, assistant finalization, and persistence, and add or refresh the Mermaid sequence diagram for that lifecycle using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent architecture documentation aligned with the implemented runtime lifecycle.
15. [ ] Update this story file’s Task 8 `Implementation notes` section after the code and tests for this task are complete.
16. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/reingest-step-lifecycle.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 9. Support `reingest` Items In Direct Agent Command Runs

- Task Status: `__to_do__`
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

#### Subtasks

1. [ ] Read the current direct command step loop and the blocking re-ingest service before wiring `reingest` items into direct command execution.
2. [ ] Update [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so `reingest` items:
   - execute once and do not participate in AI retry prompt injection;
   - use the exact `sourceId` contract already enforced by [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts);
   - record terminal outcomes through the shared re-ingest result contract from Task 7;
   - normalize any accepted blocking-service `skipped` outcome to the public terminal step status `completed`;
   - continue after terminal `completed`, `cancelled`, or `error` outcomes;
   - observe stop/cancel requests only after the blocking re-ingest call returns and before the next command item starts;
   - fail immediately for pre-start validation/service refusal paths;
   - fail the command clearly if the re-ingest path throws an unexpected exception before a trustworthy terminal result can be recorded.
3. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) proving `reingest` items bypass retry prompt injection. Purpose: prove re-ingest execution stays single-attempt and does not reuse message retry instructions.
4. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a terminal `completed` outcome. Purpose: prove a successful re-ingest result is recorded and the next command item runs.
5. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a terminal `cancelled` outcome. Purpose: prove a cancelled re-ingest result is still recorded as a non-fatal step result.
6. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a terminal `error` outcome. Purpose: prove an accepted terminal error remains non-fatal once the step has started.
7. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for accepted `skipped` outcomes recorded as public `completed`. Purpose: prove the direct-command path keeps the existing status normalization contract.
8. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for stop/cancel during the blocking wait. Purpose: prove the next command item does not start after re-ingest returns when cancellation is pending.
9. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for a malformed `sourceId` value. Purpose: prove syntactically invalid re-ingest input fails as a pre-start error before later items begin.
10. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for an unknown `sourceId` value. Purpose: prove well-formed but non-ingested repository paths fail as a pre-start error before later items begin.
11. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for busy/locked pre-start re-ingest rejection. Purpose: prove service-level refusal stops the direct command clearly.
12. [ ] Add one unit test in [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) for unexpected thrown exceptions before a trustworthy terminal result exists. Purpose: prove non-contract exceptions fail the command clearly.
13. [ ] Add one integration test in [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts) for a command file that mixes one `reingest` item and one `message` item. Purpose: prove end-to-end execution order across re-ingest and message steps.
14. [ ] Add one integration test in [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts) for multiple `reingest` items in one direct command run with distinct `callId` values. Purpose: prove repeated re-ingest results remain distinguishable.
15. [ ] Add one integration test in [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts) for a mixed run containing `reingest`, `message.markdownFile`, and `message.content`. Purpose: prove the full mixed-item happy path preserves ordering and non-fatal continuation.
16. [ ] Reuse the shared non-agent step emission path from Task 8 so direct-command `reingest` items produce live `tool_event` updates, inflight snapshots, persisted `toolCalls`, and normal assistant turn finalization without inventing a separate direct-command-only persistence shape.
17. [ ] If this task adds a new direct-command re-ingest integration test file such as [commands.reingest.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/commands.reingest.test.ts), or adds any permanent fixture directory or helper file, update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Location: repository root. Description: record each new direct-command re-ingest test file, helper file, or permanent fixture directory created by this task. Purpose: keep the repository structure reference accurate for later developers.
18. [ ] Update this story file’s Task 9 `Implementation notes` section after the code and tests for this task are complete.
19. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-runner.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/commands.reingest.test.ts`
7. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 10. Support Dedicated Flow `reingest` Steps

- Task Status: `__to_do__`
- Git Commits:

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
- Repeat the runtime rule inside this task: pre-start validation or service-refusal failures stop the flow; once a blocking re-ingest has started and returns a terminal result, `completed`, `cancelled`, and `error` are recorded as structured nested results and are non-fatal to later steps unless a stop/cancel is pending before the next step.
- Existing evidence in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) already covers fatal and validation-style flow failures. Extend that file rather than creating a second unrelated integration test structure.

#### Subtasks

1. [ ] Read the current flow step dispatcher and the existing flow error tests before adding the dedicated `reingest` step.
2. [ ] Update flow startup and validation paths in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) so flows containing `reingest` steps remain runnable. This includes:
   - allowing `reingest` in any helper or guard that currently assumes only `llm`, `break`, `command`, and `startLoop` exist;
   - supporting flows whose only executable steps are `reingest`;
   - reusing the existing `FALLBACK_MODEL_ID` path already present in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) when no agent-config-derived model is available because the flow contains no agent steps, rather than inventing a new model-resolution source.
3. [ ] Add a dedicated flow `reingest` execution path in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) that:
   - calls the blocking re-ingest service once;
   - records terminal outcomes through the shared re-ingest result contract from Task 7;
   - normalizes any accepted blocking-service `skipped` outcome to the public terminal step status `completed`;
   - continues after terminal `completed`, `cancelled`, or `error` outcomes;
   - fails the current run for pre-start validation/service refusal paths;
   - observes stop/cancel requests only after the blocking re-ingest call returns and before the next flow step starts;
   - fails the current flow clearly if the re-ingest path throws an unexpected exception before a trustworthy terminal result can be recorded;
   - keeps outer run status and nested re-ingest result status distinct.
4. [ ] Reuse the shared non-agent step emission path from Task 8 so dedicated flow `reingest` steps create inflight state, publish `tool_event` updates, and persist assistant turns with populated `toolCalls` instead of the current `toolCalls: null` fallback path used by synthetic failed/stopped flow steps.
5. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a post-start terminal `error` outcome. Purpose: prove an accepted terminal error result is recorded but does not stop the rest of the flow.
6. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a post-start terminal `cancelled` outcome. Purpose: prove a cancelled re-ingest result is still recorded as a non-fatal step result.
7. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for accepted `skipped` outcomes recorded as public `completed`. Purpose: prove the dedicated flow-step path keeps the status normalization contract.
8. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a malformed `sourceId` value. Purpose: prove syntactically invalid re-ingest input fails as a pre-start error before later steps begin.
9. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for an unknown `sourceId` value. Purpose: prove well-formed but non-ingested repository paths fail as a pre-start error before later steps begin.
10. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for busy/locked pre-start re-ingest rejection. Purpose: prove service-level refusal stops the flow clearly.
11. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for unexpected thrown exceptions before a trustworthy terminal result exists. Purpose: prove non-contract exceptions fail the current flow.
12. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for stop/cancel during the blocking wait. Purpose: prove the next flow step does not start after re-ingest returns when cancellation is pending.
13. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a timeout result becoming a nested `error` outcome. Purpose: prove timeout handling stays structured and does not crash the run.
14. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a missing-run result becoming a nested `error` outcome. Purpose: prove missing post-launch status stays structured and does not crash the run.
15. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for an unknown terminal result becoming a nested `error` outcome. Purpose: prove unknown terminal states stay structured and do not crash the run.
16. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for a flow that contains only `reingest` steps. Purpose: prove reingest-only flows start successfully and use the fallback flow model metadata path.
17. [ ] Add one integration test in [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) for multiple dedicated `reingest` steps targeting the same `sourceId` with distinct `callId` values. Purpose: prove repeated flow-step re-ingest results remain distinguishable.
18. [ ] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document the dedicated flow `reingest` step, including pre-start fatal failures, post-start non-fatal terminal outcomes, and reingest-only flow startup, and add or refresh the Mermaid diagram for this flow-step behavior using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent flow architecture documentation aligned with the implemented dedicated re-ingest step behavior.
19. [ ] Update this story file’s Task 10 `Implementation notes` section after the code and tests for this task are complete.
20. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.errors.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 11. Reuse `reingest` Item Execution Inside Flow Command Steps

- Task Status: `__to_do__`
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

#### Subtasks

1. [ ] Compare the direct command `reingest` path from Task 9 with the flow command-item path from Task 6 before making changes.
2. [ ] Update the shared command-item execution path so flow-owned command files can execute `reingest` items with the same behavior as direct commands:
   - one attempt only;
   - structured `tool-result` recording;
   - pre-start failure handling;
   - continuation after terminal `completed`, `cancelled`, or `error`.
3. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a flow command step whose command file contains `reingest`. Purpose: prove flow-owned commands can execute re-ingest items at all.
4. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for live `tool_event` recording of a flow-command re-ingest result. Purpose: prove the flow-command re-ingest path reuses the current live runtime contract.
5. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for persisted turn-storage recording of a flow-command re-ingest result. Purpose: prove the flow-command re-ingest path reuses the current persisted runtime contract.
6. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for multiple re-ingest results with distinct `callId` values. Purpose: prove repeated flow-command re-ingest results remain distinguishable.
7. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for a mixed command file containing `reingest`, `message.markdownFile`, and `message.content`. Purpose: prove mixed-item ordering and non-fatal continuation inside flow-owned command execution.
8. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for stop/cancel during the blocking wait. Purpose: prove later command items or later flow steps do not start after the current re-ingest returns when cancellation is pending.
9. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for surrounding retry behavior with `message` items after the shared executor change. Purpose: prove existing retry behavior for message execution remains intact.
10. [ ] Add one integration test in [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) for single-attempt behavior of `reingest` items in the same command file. Purpose: prove re-ingest items do not participate in message retry behavior.
11. [ ] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document flow-command re-ingest parity with direct commands, including shared executor boundaries and mixed command-item behavior, and add or refresh the Mermaid diagram for this flow-command path using Context7 Mermaid docs as the syntax reference. Purpose: keep the permanent architecture documentation aligned with the final parity design.
12. [ ] Update this story file’s Task 11 `Implementation notes` section after the code and tests for this task are complete.
13. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts`
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 12. Update Documentation And Project Structure For Story 45

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Update the permanent documentation after the implementation tasks are complete so the repository explains the new command and flow capabilities accurately. This task is documentation-only and should not introduce new runtime behavior.

#### Documentation Locations

- Context7 Mermaid documentation: resolve the Mermaid library in Context7 before editing any Mermaid syntax for this task - use it as the primary syntax reference for `design.md` diagram updates.
- Mermaid documentation: https://mermaid.js.org/intro/ - use as a secondary reference if Context7 is unavailable when validating `design.md` diagram syntax.
- Markdown Guide: https://www.markdownguide.org/basic-syntax/ - use for the markdown formatting of README and design updates introduced by this story.
- Docker Compose documentation: https://docs.docker.com/compose/ - use for documenting the compose-based validation workflow accurately in permanent repo docs.

#### Critical Task Rules

- This task is documentation-only. Do not introduce runtime behavior changes while updating docs. Re-read the accepted Story 45 contracts in [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md) and document only what the implementation actually does.
- [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) must explain the user-facing file formats and folder expectations, especially `codeinfo_markdown`, direct-command codeInfo2-only markdown lookup, and flow-owned repository-aware fallback lookup.
- [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) must explain the architecture choices: reusing existing websocket events, existing `Turn.toolCalls` persistence, existing blocking `reingestService`, and the fact that Story 45 does not add paused execution, resumable state, or a new protocol surface.
- [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) must list every new helper, test file, and permanent fixture directory introduced by this story so later juniors can discover them quickly.

#### Subtasks

1. [ ] Update document [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md). Location: repository root. Description: add the user-facing explanation for command and flow `reingest`, markdown-backed steps, and the `codeinfo_markdown` folder expectations. Purpose: give developers and operators one clear entry point for the new Story 45 file formats and usage rules.
2. [ ] Update document [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md). Location: repository root. Description: document the final command/flow architecture, tool-result contract, repository resolution behavior, reuse of existing websocket and persistence contracts, the absence of paused execution or a new protocol surface, and refresh any Mermaid diagrams required to show the final architecture using Context7 Mermaid docs as the primary syntax reference. Purpose: keep the permanent architecture reference aligned with the final Story 45 implementation.
3. [ ] Update document [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md). Location: repository root. Description: list every new helper file, test file, and permanent fixture directory added by Story 45 in the correct repository sections. Purpose: keep the repository structure reference accurate and discoverable for later developers.
4. [ ] Update this story file’s Task 12 `Implementation notes` section after the documentation updates are complete.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] Perform one manual documentation sanity read of the changed README/design/project structure sections to confirm they describe the final Story 45 behavior consistently and do not contradict the runtime contracts.
6. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 13. Final Validation And Acceptance Check

- Task Status: `__to_do__`
- Git Commits:

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
- The manual Playwright check must confirm the server-side Story 45 behavior does not break the current UI. Save screenshots to the exact directory already named in this task so reviewers can inspect the final validation evidence later.

#### Subtasks

1. [ ] Re-read the full Story 45 acceptance criteria and confirm every earlier implementation task is marked done before starting this final task.
2. [ ] Build the server.
3. [ ] Build the client.
4. [ ] Perform a clean Docker build.
5. [ ] Ensure [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) is fully up to date for Story 45.
6. [ ] Ensure [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) is fully up to date for Story 45, including any diagrams added during implementation.
7. [ ] Ensure [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) is fully up to date for Story 45.
8. [ ] Create a pull-request summary comment covering all Story 45 changes and save or record it in the normal repo workflow location used by the team.
9. [ ] Update this story file’s Task 13 `Implementation notes` section after the full validation pass is complete.
10. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server`
2. [ ] `npm run build:summary:client`
3. [ ] `npm run compose:build:summary`
4. [ ] `npm run compose:up`
5. [ ] `npm run test:summary:server:unit`
6. [ ] `npm run test:summary:server:cucumber`
7. [ ] `npm run test:summary:client`
8. [ ] `npm run test:summary:e2e`
9. [ ] Use Playwright against the running stack to perform a manual end-to-end check for:
   - a direct command that uses `message.markdownFile`;
   - a flow `llm` step that uses `markdownFile`;
   - a direct command that mixes `reingest`, `message.markdownFile`, and `message.content` items in one run;
   - a flow that mixes `llm.markdownFile`, a dedicated `reingest` step, and a command step;
   - a direct command or flow step that records a non-fatal re-ingest terminal result;
   - correct UI stability while those server-side behaviors run.
   Save screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/test-results/screenshots/` using names that start with `0000045-task13-`.
10. [ ] `npm run compose:down`

#### Implementation notes

- 
