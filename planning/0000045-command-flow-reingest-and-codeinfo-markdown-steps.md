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

### 1. Add Command And Flow Schema Support For `markdownFile` And `reingest`

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Update the JSON parsing layer so Story 45's new command items and flow steps are accepted or rejected correctly before any runtime behavior changes are attempted. This task is only about schema contracts and schema-focused tests, which makes it the safest first implementation step for the story.

#### Documentation Locations

- Story contract source: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)
- Command schema implementation: [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts)
- Flow schema implementation: [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts)
- Existing schema tests: [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts)
- Existing schema tests: [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts)
- Zod documentation for unions and refinements: https://zod.dev

#### Subtasks

1. [ ] Read the Story 45 command and flow contracts, then read the existing schema files and schema tests before making any edits. Confirm exactly where `message`, `llm`, and the flow-step discriminated union are currently defined.
2. [ ] Update [commandsSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsSchema.ts) so command `items` become a discriminated union that supports:
   - `message` items with exactly one of `content` or `markdownFile`;
   - `reingest` items with `sourceId`;
   - the existing top-level `{ Description, items }` contract with no renaming.
3. [ ] Update [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts) so the flow step union supports:
   - `llm` steps with exactly one of `messages` or `markdownFile`;
   - `reingest` steps with `sourceId` and optional `label`;
   - unchanged `command`, `break`, and `startLoop` steps.
4. [ ] Extend [agent-commands-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-schema.test.ts) with positive and negative coverage for:
   - `message.content`;
   - `message.markdownFile`;
   - `reingest`;
   - both/neither XOR failures;
   - unexpected extra keys.
5. [ ] Extend [flows-schema.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/flows-schema.test.ts) with matching positive and negative coverage for:
   - `llm.messages`;
   - `llm.markdownFile`;
   - `reingest`;
   - both/neither XOR failures;
   - unexpected extra keys.
6. [ ] Update this story file’s Task 1 `Implementation notes` section after the code and tests for this task are complete.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

#### Testing

1. [ ] `npm run build:summary:server` - required because this task changes server TypeScript schemas and parser logic.
2. [ ] `npm run build:summary:client` - required because server contract type changes can still reveal shared-package or workspace regressions.
3. [ ] `npm run compose:build:summary` - required to prove the updated schema code still builds in the containerized path.
4. [ ] `npm run compose:up` - required so later tasks inherit a known-good stack after the schema change.
5. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-schema.test.ts`
6. [ ] `npm run test:summary:server:unit -- --file server/src/test/unit/flows-schema.test.ts`
7. [ ] `npm run compose:down`

#### Implementation notes

- 

---

### 2. Add The Shared Markdown Resolver And Its Safety Rules

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Create the shared markdown-file lookup and decoding helper that all later markdown-backed runtime work will depend on. This task only implements repository candidate ordering, path validation, strict UTF-8 decoding, and focused unit coverage for that helper.

#### Documentation Locations

- Story markdown rules: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)
- Existing repository ordering logic: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts)
- Node.js path documentation: https://nodejs.org/api/path.html
- Node.js `fs` documentation: https://nodejs.org/api/fs.html
- Node.js `util.TextDecoder` documentation: https://nodejs.org/api/util.html#class-utiltextdecoder

#### Subtasks

1. [ ] Read the Story 45 markdown-resolution contract and the existing flow repository-ordering helpers in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) before creating any new helper.
2. [ ] Add one shared resolver module in the server codebase, preferably near the existing flow repository-ordering code, that:
   - validates safe relative `markdownFile` paths under `codeinfo_markdown`;
   - rejects empty values, absolute paths, and traversal/escape attempts;
   - builds candidate repositories in the documented same-source, codeInfo2, other-repos order;
   - continues on missing files only;
   - fails immediately when a higher-priority candidate contains the file but it cannot be read or decoded.
3. [ ] Implement strict UTF-8 decoding in that resolver so invalid bytes fail clearly instead of being silently replaced.
4. [ ] Add focused unit coverage for the new resolver helper. Include:
   - direct-command codeInfo2-only lookup;
   - same-source flow lookup;
   - codeInfo2 fallback;
   - deterministic other-repo fallback;
   - deterministic tie-breaking when multiple fallback repositories share the same case-insensitive source label and file path names differ only by repository path;
   - all-candidates-missing failure;
   - unreadable-file fail-fast behavior;
   - invalid UTF-8 failure;
   - path traversal rejection.
5. [ ] If this task adds a new resolver file or test file, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after those file additions are complete.
6. [ ] Update this story file’s Task 2 `Implementation notes` section after the code and tests for this task are complete.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

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

### 3. Support `message.markdownFile` In Direct Agent Command Runs

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Teach the direct command runner to execute markdown-backed `message` items without changing flow behavior yet. This task is only about direct command `message.markdownFile` execution, preserving the existing retry logic for AI instruction steps and reusing the shared resolver from Task 2.

#### Documentation Locations

- Command runner implementation: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts)
- Command loader: [commandsLoader.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsLoader.ts)
- Existing command runner tests: [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts)
- Story markdown rules: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)

#### Subtasks

1. [ ] Read [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) and the existing runner tests before changing direct command execution.
2. [ ] Update the direct command runner so `message` items:
   - keep the current `content.join('\n')` behavior when `content` is used;
   - resolve one markdown file into one instruction string when `markdownFile` is used;
   - use codeInfo2-only repository scope for direct commands that are not running inside a flow.
3. [ ] Keep the existing retry path for message-based agent instruction execution. This task must not add `reingest` execution yet and must not change retry-prompt behavior for `message` items.
4. [ ] Extend [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) to prove:
   - a markdown-backed direct command executes exactly one instruction;
   - the loaded markdown is passed through verbatim;
   - a markdown file not found or not decodable fails the command step clearly;
   - an unexpected markdown-resolver exception fails the command clearly instead of being swallowed or converted into empty content;
   - the existing `content` path still behaves unchanged.
5. [ ] If this task adds direct-command markdown fixtures under temporary agent command folders or permanent fixtures, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) if the permanent repo structure changes.
6. [ ] Update this story file’s Task 3 `Implementation notes` section after the code and tests for this task are complete.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

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

### 4. Support `llm.markdownFile` In Flow Steps

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Teach the flow runner to execute markdown-backed `llm` steps using the shared markdown resolver and the current flow repository context. This task is only about flow `llm` steps and must not yet change flow command-step item execution or any re-ingest behavior.

#### Documentation Locations

- Flow execution implementation: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts)
- Flow schema and types: [flowSchema.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/flowSchema.ts)
- Existing flow integration tests: [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts)
- Story markdown rules: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)

#### Subtasks

1. [ ] Read the current `runLlmStep(...)` path in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) and the existing flow execution tests before making changes.
2. [ ] Update the flow runner so an `llm` step with `markdownFile` resolves exactly one markdown file into one instruction string and executes it once through the existing agent-turn path.
3. [ ] Keep the current `messages` array behavior unchanged for existing flow `llm` steps, including current retry behavior and current turn persistence for successful and failed agent turns.
4. [ ] Extend [flows.run.basic.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.basic.test.ts) to prove:
   - same-source markdown resolution works for a flow `llm` step;
   - fallback to codeInfo2 or other repositories follows the documented deterministic order;
   - a higher-priority unreadable markdown file fails the step instead of falling through to a lower-priority repository;
   - deterministic duplicate-label fallback still chooses the repository ordered by case-insensitive label and then full source path;
   - missing, undecodable, or unexpectedly thrown markdown-resolution errors fail the step clearly.
5. [ ] Update this story file’s Task 4 `Implementation notes` section after the code and tests for this task are complete.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

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

### 5. Reuse Command `message` Item Execution Inside Flow Command Steps

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Make flow command steps execute command `message` items through the same markdown-aware logic as direct commands. This task is only about flow-owned command execution for `message` items, so it can be tested independently before any `reingest` item work starts.

#### Documentation Locations

- Flow command-step execution: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts)
- Direct command runner: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts)
- Existing flow command tests: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts)
- Story repository-ordering rules: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)

#### Subtasks

1. [ ] Read the current flow command-step execution loop in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) and compare it to the direct command path in [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts).
2. [ ] Extract or centralize command `message` item execution so both direct commands and flow command steps use the same logic for:
   - `content` items;
   - `markdownFile` items;
   - repository-context-aware resolution when a command is executed from inside a flow.
3. [ ] Keep this task focused on `message` items only. Do not add `reingest` item execution in this task.
4. [ ] Extend [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) to prove:
   - a flow command step can execute a command file containing `message.markdownFile`;
   - the parent flow repository context is used for same-source and fallback resolution;
   - a higher-priority unreadable markdown file in the parent flow context fails fast instead of silently falling through;
   - the flow command path does not drift from the direct command `message` behavior.
5. [ ] If this task introduces a shared command-item execution module, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after the file is added.
6. [ ] Update this story file’s Task 5 `Implementation notes` section after the code and tests for this task are complete.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

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

### 6. Add Shared Re-Ingest Tool-Result Recording

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Implement the shared runtime helper or code path that converts re-ingest terminal outcomes into the exact live and persisted `tool-result` shapes required by Story 45. This task is only about message contracts and storage shapes for re-ingest results, and it must land before any task that starts executing `reingest` steps.

#### Documentation Locations

- Story runtime contract: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)
- Current inflight tool-event type: [inflightRegistry.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/inflightRegistry.ts)
- Current chat tool-result type: [ChatInterface.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/chat/interfaces/ChatInterface.ts)
- Turn persistence shape: [turn.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/mongo/turn.ts)
- Existing flow tool-call persistence path: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts)

#### Subtasks

1. [ ] Read the current `ToolEvent`, `ChatToolResultEvent`, and `Turn.toolCalls` shapes before adding any new helper or payload builder.
2. [ ] Add one shared re-ingest result builder or equivalent shared path that:
   - converts a terminal re-ingest outcome into the nested `reingest_step_result` payload;
   - wraps it in the existing `tool-result` shape for live events and persisted tool calls;
   - reuses the existing `tool_event`, `inflight_snapshot.inflight.toolEvents`, and `Turn.toolCalls` contracts instead of introducing a new websocket event type, new top-level conversation flag, or new persisted collection;
   - includes a stable `callId`;
   - preserves distinct `callId` values when multiple re-ingest results are recorded in one run.
3. [ ] Keep this task contract-only. Do not yet wire direct command or flow `reingest` execution to call the helper.
4. [ ] Add unit coverage for the helper or shared path. Include:
   - `completed`, `cancelled`, and `error` terminal outcomes;
   - outer `stage` mapping;
   - nested payload fields;
   - compatibility with the existing live `tool-result` wrapper shape and persisted `Turn.toolCalls` wrapper shape;
   - distinct `callId` values for multiple results.
5. [ ] If this task adds a new shared helper file or test file, update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) after the file is added.
6. [ ] Update this story file’s Task 6 `Implementation notes` section after the code and tests for this task are complete.
7. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

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

### 7. Support `reingest` Items In Direct Agent Command Runs

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Teach the direct command runner to execute `reingest` items once, record their structured result, and continue or fail according to Story 45’s direct-command rules. This task is only about direct command `reingest` items and must reuse the shared result-recording contract from Task 6.

#### Documentation Locations

- Direct command execution: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts)
- Blocking re-ingest service: [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts)
- Existing direct command tests: [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts)
- Existing re-ingest service tests: [reingestService.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/reingestService.test.ts)

#### Subtasks

1. [ ] Read the current direct command step loop and the blocking re-ingest service before wiring `reingest` items into direct command execution.
2. [ ] Update [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts) so `reingest` items:
   - execute once and do not participate in AI retry prompt injection;
   - use the exact `sourceId` contract already enforced by [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts);
   - record terminal outcomes through the shared re-ingest result contract from Task 6;
   - normalize any accepted blocking-service `skipped` outcome to the public terminal step status `completed`;
   - continue after terminal `completed`, `cancelled`, or `error` outcomes;
   - observe stop/cancel requests only after the blocking re-ingest call returns and before the next command item starts;
   - fail immediately for pre-start validation/service refusal paths;
   - fail the command clearly if the re-ingest path throws an unexpected exception before a trustworthy terminal result can be recorded.
3. [ ] Extend [agent-commands-runner.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/unit/agent-commands-runner.test.ts) to prove:
   - `reingest` items bypass retry prompt injection;
   - terminal `completed`, `cancelled`, and `error` outcomes are recorded and allow the next item to run;
   - accepted `skipped` outcomes are recorded as terminal `completed`;
   - a stop/cancel request raised during the blocking wait prevents the next command item from starting after the re-ingest returns;
   - pre-start failures and unexpected thrown exceptions stop the command clearly.
4. [ ] Add or update direct integration coverage for a command file that mixes `reingest` and `message` items so the execution order is proven end to end. Include a case with multiple `reingest` items in one direct command run and prove their recorded `callId` values stay distinct.
5. [ ] Update this story file’s Task 7 `Implementation notes` section after the code and tests for this task are complete.
6. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

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

### 8. Support Dedicated Flow `reingest` Steps

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Teach the flow runner to execute dedicated `reingest` steps and to respect Story 45’s pre-start versus post-start outcome rules. This task is only about the flow-level `reingest` step type and must not yet add `reingest` item support inside flow-owned command files.

#### Documentation Locations

- Flow execution implementation: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts)
- Blocking re-ingest service: [reingestService.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/ingest/reingestService.ts)
- Existing flow error tests: [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts)
- Story edge cases: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)

#### Subtasks

1. [ ] Read the current flow step dispatcher and the existing flow error tests before adding the dedicated `reingest` step.
2. [ ] Add a dedicated flow `reingest` execution path in [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts) that:
   - calls the blocking re-ingest service once;
   - records terminal outcomes through the shared re-ingest result contract from Task 6;
   - normalizes any accepted blocking-service `skipped` outcome to the public terminal step status `completed`;
   - continues after terminal `completed`, `cancelled`, or `error` outcomes;
   - fails the current run for pre-start validation/service refusal paths;
   - observes stop/cancel requests only after the blocking re-ingest call returns and before the next flow step starts;
   - fails the current flow clearly if the re-ingest path throws an unexpected exception before a trustworthy terminal result can be recorded;
   - keeps outer run status and nested re-ingest result status distinct.
3. [ ] Extend [flows.run.errors.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.errors.test.ts) to prove:
   - post-start `error` and `cancelled` outcomes are recorded but non-fatal;
   - accepted `skipped` outcomes are recorded as terminal `completed`;
   - pre-start failures and unexpected thrown exceptions stop the flow;
   - a stop/cancel request raised during the blocking wait prevents the next flow step from starting after the re-ingest returns;
   - timeout, missing-run, or unknown terminal results become nested `error` outcomes instead of crashing the run.
4. [ ] Update this story file’s Task 8 `Implementation notes` section after the code and tests for this task are complete.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

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

### 9. Reuse `reingest` Item Execution Inside Flow Command Steps

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Finish Story 45’s parity work by making flow-owned command files execute `reingest` items through the same single-attempt and structured-result behavior as direct commands. This task is only about `reingest` items inside flow command steps, which keeps the final command-parity work isolated and testable.

#### Documentation Locations

- Flow command-step execution: [service.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/flows/service.ts)
- Direct command execution: [commandsRunner.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/agents/commandsRunner.ts)
- Existing flow command integration tests: [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts)
- Story re-ingest contract: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)

#### Subtasks

1. [ ] Compare the direct command `reingest` path from Task 7 with the flow command-item path from Task 5 before making changes.
2. [ ] Update the shared command-item execution path so flow-owned command files can execute `reingest` items with the same behavior as direct commands:
   - one attempt only;
   - structured `tool-result` recording;
   - pre-start failure handling;
   - continuation after terminal `completed`, `cancelled`, or `error`.
3. [ ] Extend [flows.run.command.test.ts](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/server/src/test/integration/flows.run.command.test.ts) to prove:
   - a flow command step can execute a command file containing `reingest`;
   - structured results are recorded through the existing tool-event and turn-storage paths;
   - multiple re-ingest results in one run keep distinct `callId` values;
   - a stop/cancel request raised during the blocking wait prevents later command items or later flow steps from starting after the current re-ingest returns.
4. [ ] Update this story file’s Task 9 `Implementation notes` section after the code and tests for this task are complete.
5. [ ] Run `npm run lint --workspaces` and `npm run format:check --workspaces`; if either fails, run the repo’s fix commands and resolve any remaining issues before marking the task done.

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

### 10. Update Documentation And Project Structure For Story 45

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Update the permanent documentation after the implementation tasks are complete so the repository explains the new command and flow capabilities accurately. This task is documentation-only and should not introduce new runtime behavior.

#### Documentation Locations

- Permanent repo documentation: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
- Permanent repo documentation: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
- Repository structure file: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)
- Story source of truth: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)

#### Subtasks

1. [ ] Update [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) with any user-facing explanation needed for command/flow `reingest` and markdown-backed steps, including any new repository folder expectations such as `codeinfo_markdown`.
2. [ ] Update [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) so the command/flow architecture, tool-result contract, repository resolution behavior, and the reuse of existing websocket/persistence contracts match the final implementation. State clearly that Story 45 does not add paused execution, resumable state, or a new websocket protocol surface.
3. [ ] Update [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) to list any new helper files, test files, or fixture directories added by Story 45.
4. [ ] Update this story file’s Task 10 `Implementation notes` section after the documentation updates are complete.
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

### 11. Final Validation And Acceptance Check

- Task Status: `__to_do__`
- Git Commits:

#### Overview

Verify the complete story against the acceptance criteria after all earlier tasks are finished. This final task must prove that the finished Story 45 behavior works end to end, that all permanent documentation is current, and that the final PR summary can be written from the completed work.

#### Documentation Locations

- Story acceptance criteria: [0000045-command-flow-reingest-and-codeinfo-markdown-steps.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md)
- Docker/Compose workflow: [AGENTS.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/AGENTS.md)
- Playwright documentation: https://playwright.dev/docs/intro
- Permanent repo documentation: [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md)
- Permanent repo documentation: [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md)
- Repository structure file: [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md)

#### Subtasks

1. [ ] Re-read the full Story 45 acceptance criteria and confirm every earlier implementation task is marked done before starting this final task.
2. [ ] Build the server.
3. [ ] Build the client.
4. [ ] Perform a clean Docker build.
5. [ ] Ensure [README.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/README.md) is fully up to date for Story 45.
6. [ ] Ensure [design.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/design.md) is fully up to date for Story 45, including any diagrams added during implementation.
7. [ ] Ensure [projectStructure.md](/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/projectStructure.md) is fully up to date for Story 45.
8. [ ] Create a pull-request summary comment covering all Story 45 changes and save or record it in the normal repo workflow location used by the team.
9. [ ] Update this story file’s Task 11 `Implementation notes` section after the full validation pass is complete.
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
   - a direct command or flow step that records a non-fatal re-ingest terminal result;
   - correct UI stability while those server-side behaviors run.
   Save screenshots under `/Users/danielstapleton/Documents/dev/codeinfo2/codeInfo2/test-results/screenshots/` using names that start with `0000045-task11-`.
10. [ ] `npm run compose:down`

#### Implementation notes

- 
