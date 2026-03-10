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
  - cancellation requested while a blocking re-ingest step is already waiting.
- Reuse temporary test directories and existing fixture patterns (`server/src/test/fixtures/flows`, temp `codex_agents/.../commands` folders) instead of adding a large permanent fixture set up front.
