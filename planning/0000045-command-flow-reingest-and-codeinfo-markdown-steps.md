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

For markdown files, the user has chosen a repository-level folder named `codeinfo_markdown`, similar to repository `flows` support. Markdown files must be resolved using deterministic repository priority rules instead of ad hoc relative paths:

- same source repository as the running flow or repository-scoped command;
- then the codeInfo2 repository;
- then other ingested repositories sorted by case-insensitive source label and then case-insensitive full source path.

For local-only command execution where there is no separate repository source, the same-source and codeInfo2 repository collapse to the same location in the codeInfo2 repository.

For re-ingest steps, the story reuses the server’s existing blocking re-ingest behavior. The step must wait until ingest finishes with a terminal status such as completed, cancelled, or error before the runner may continue. If re-ingest fails, the command or flow still continues to the next step, but the step result must be recorded in a structured way so users and later debugging can see exactly what happened.

This story deliberately excludes user-input waiting. That will be handled in a later story because it requires a new paused/resumable run state rather than a normal synchronous step.

### Acceptance Criteria

- Command JSON supports a step that triggers repository re-ingest.
- Flow JSON supports a step that triggers repository re-ingest.
- The re-ingest step accepts a repository identifier that maps to an already ingested repository root.
- The re-ingest step waits for a terminal ingest result before the runner is allowed to start the next step.
- Re-ingest terminal outcomes of `completed`, `cancelled`, and `error` are all handled explicitly.
- A re-ingest failure does not stop the overall command or flow run.
- A re-ingest step records structured output that includes the terminal status and identifying metadata such as repository id/source id, ingest run id, and any available error code.
- Command JSON supports an `llm`-style step that uses a markdown file reference instead of the existing message-array content.
- Flow JSON supports an `llm`-style step that uses a markdown file reference instead of the existing message-array content.
- For command JSON and flow JSON, the `llm` step enforces XOR validation:
  - either the markdown-file field is provided;
  - or the message-array field is provided;
  - but never both.
- Markdown file contents are read as UTF-8 and passed through verbatim with no trimming, line rewriting, whitespace cleanup, or prompt reformatting before they are sent to the AI agent.
- Markdown files are resolved from `codeinfo_markdown`.
- Repository-scoped markdown resolution order is:
  - same source repository first;
  - codeInfo2 repository second;
  - other ingested repositories last in deterministic case-insensitive source-label order with case-insensitive source-path tie-break.
- If the same-source repository contains the requested markdown file, that file wins even if the same file name exists elsewhere.
- If the same-source repository does not contain the requested markdown file, the resolver falls back to codeInfo2 and then to other repositories using the deterministic order above.
- Local-only command execution behaves predictably when no repository source is selected:
  - it resolves `codeinfo_markdown` from the codeInfo2 repository;
  - it does not invent an ambiguous repository order.
- Invalid markdown-file references produce clear step failures.
- Invalid same-source markdown files or read failures fail fast for that candidate rather than silently pretending the file was read successfully.
- Existing message-array `llm` behavior continues to work for commands and flows when no markdown-file field is used.
- This story does not add any paused or resumable workflow state.

### Out Of Scope

- Any step that waits for the user to type content during an active run.
- REST or websocket contracts for paused or resumable command/flow execution.
- Free-form filesystem-relative markdown lookup outside of `codeinfo_markdown`.
- Replacing existing flow command-resolution behavior with a new global resolver order beyond the markdown resolution needed by this story.
- Adding new command or flow step types unrelated to re-ingest or markdown-backed `llm`.
- Changing agent instruction semantics outside of what is required to pass verbatim markdown content.

### Questions

1. Should command JSON stay on the current `Description + items[]` shape, or should this story introduce a new command `steps[]` shape that looks more like flows?
Why this is important:
Changing the top-level command shape would affect backward compatibility, schema validation, loader behavior, runner behavior, existing command files, and any documentation that already assumes the current format. This is the biggest structural choice in this story because it decides whether Story 0000045 is an additive change or a schema-migration story.
Best answer:
Keep the existing `Description + items[]` command shape and expand command items into a discriminated union so commands can support additional executable item types such as `message`, `reingest`, and markdown-backed `llm` without replacing the top-level file format.
Why this is the best answer:
It is the lowest-risk path, it preserves existing command files, it avoids an unnecessary migration, and it keeps this story focused on adding capability rather than redesigning the whole command format. Flows already have their own step schema, so commands do not need to become structurally identical in order to gain the same features.

2. Should `codeinfo_markdown` support only flat file names, or should it allow safe relative subpaths under that folder?
Why this is important:
This decision controls how scalable the markdown library becomes. Flat names are simpler to validate, but they become awkward once a repository has many reusable markdown files. Safe relative subpaths add more flexibility, but they need clear path-traversal rules and consistent lookup behavior.
Best answer:
Allow safe relative subpaths under `codeinfo_markdown`, for example `architecture/auth/login.md`, while forbidding absolute paths, `..` traversal, and any lookup that escapes the resolved `codeinfo_markdown` root.
Why this is the best answer:
It keeps the lookup safe while making the folder genuinely useful as a repository-level markdown library. A flat-only rule would likely become a limitation quickly and force another story later. Safe subpaths give users enough structure to organize markdown inputs properly without opening the door to arbitrary filesystem access.

## Implementation Ideas

- Extend `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts` with new step shapes that remain explicitly typed and mutually exclusive where required.
- Reuse `server/src/ingest/reingestService.ts` for blocking re-ingest execution instead of reimplementing polling logic in command or flow runners.
- Introduce one shared markdown resolution helper so commands and flows do not drift.
- Base repository ordering on the existing deterministic flow repository ordering in `server/src/flows/service.ts`.
- Define a concrete `codeinfo_markdown` file-reference contract:
  - safe relative paths only, not absolute paths or arbitrary path traversal;
  - resolved under `<repo>/codeinfo_markdown`;
  - same-source/codeInfo2/other fallback in deterministic order.
- Keep the existing message-array path untouched for backward compatibility.
- For flows, integrate the new behavior into the existing step execution loop in `server/src/flows/service.ts`.
- For commands, extend the current command runner in `server/src/agents/commandsRunner.ts` while preserving start-step, retry, and cancellation behavior.
- Add tests for:
  - schema XOR validation;
  - verbatim markdown pass-through;
  - same-source markdown success;
  - codeInfo2 fallback;
  - deterministic other-repository fallback;
  - blocking re-ingest continuation after completed/cancelled/error outcomes;
  - non-fatal re-ingest failure continuation.
