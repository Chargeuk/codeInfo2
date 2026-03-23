# Story 0000052 – Users can reingest the working repository or plan scope

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Commands and flows already support a dedicated re-ingest step, but the current targeting language no longer matches how the product is actually used. The existing `current` target means "the repository that owns the flow or command file". That is technically definable, but it is not what the user wants. The user works from a selected `working_folder` repository and wants re-ingest actions to operate on that selected repository instead.

This story replaces the confusing owner-based `current` target with two targets that match the real workflow model.

The first target is `working`. This means "re-ingest the repository currently selected as the run's `working_folder`". It should work the same way for direct commands, dedicated flow re-ingest steps, and command items executed inside flows. If no working repository is selected, or if the selected working repository is not currently ingested, the step should fail before it starts with a clear error.

The second target is `plan_scope`. This means "re-ingest the current working repository and any additional repositories declared in that repository's `codeInfoStatus/flow-state/current-plan.json` file". The current repository always comes first. If the handoff file is missing, or if it exists but has no `additional_repositories`, then `plan_scope` should behave the same as `working`.

If `current-plan.json` exists but is malformed, unreadable, or includes additional repositories that are invalid or not currently ingested, `plan_scope` should not fail the whole step. Instead, it should continue with only the working repository and emit enough structured logging to make it clear that the additional repositories were ignored because the handoff could not be fully used.

The repository already uses `current-plan.json` as a canonical handoff file for multi-repository story scope. That handoff names extra repositories through `additional_repositories`, while the current repository is implicit. This story reuses that same product language rather than inventing a second related-repositories concept. The current plan-scope re-ingest should therefore read the same `additional_repositories[].path` values already used elsewhere in the repository's workflow assets.

This story is also a contract cleanup. The `current` re-ingest target should be removed rather than kept as a second name for a different meaning. Leaving `current` in place would preserve a word that already means the wrong thing in both planning and code, which would keep the product confusing for workflow authors.

This story does not remove explicit `sourceId`-based re-ingest. Users should still be able to target one specific repository by selector when they want exact control. The purpose of this story is to make the common workflow cases read naturally:

- `working` for "the repository I am working in right now";
- `plan_scope` for "the repository I am working in right now plus the related repositories declared by the current plan handoff".

The runtime should preserve deterministic behavior for `plan_scope`. Repository order should be:

1. the current working repository;
2. then repositories listed in `current-plan.json.additional_repositories` in file order.

Duplicate repositories should be removed while preserving the first occurrence. If the current working repository is also listed in `additional_repositories`, that duplicate should be ignored. If the same additional repository appears more than once, only the first occurrence should be kept.

Because `plan_scope` can touch more than one repository, it should behave like a small batch operation rather than a set of disconnected single-repository tool events. It should block until every targeted repository reaches a terminal outcome, and it should record one structured batch result that the UI, logs, and tests can reason about. This keeps the user experience aligned with the existing direction for multi-repository re-ingest work.

This story should reuse the existing batch transcript payload shape that already exists for multi-repository re-ingest. `plan_scope` is still a batch re-ingest of multiple repositories, so it should travel through the same general payload contract rather than inventing a second special-purpose batch result. The runtime should extend that existing shape by allowing `targetMode: "plan_scope"` and by populating the same ordered `repositories` array and `summary` counts already used by the current batch path.

### Acceptance Criteria

- Command JSON no longer supports `target: "current"` for re-ingest items.
- Flow JSON no longer supports `target: "current"` for re-ingest steps.
- Command JSON supports `target: "working"` for re-ingest items.
- Flow JSON supports `target: "working"` for re-ingest steps.
- Command JSON supports `target: "plan_scope"` for re-ingest items.
- Flow JSON supports `target: "plan_scope"` for re-ingest steps.
- Explicit selector-based re-ingest using `sourceId` continues to work.
- `target: "working"` re-ingests only the repository selected as the run's `working_folder`.
- `target: "working"` behaves consistently for direct commands, dedicated flow re-ingest steps, and re-ingest items inside flow-executed commands.
- If no `working_folder` is available for the run, `target: "working"` fails before the step starts with a clear validation or pre-start error.
- If the selected `working_folder` repository is not currently ingested, `target: "working"` fails before the step starts with a clear validation or pre-start error.
- `target: "plan_scope"` always includes the current working repository first.
- `target: "plan_scope"` reads extra repositories from `codeInfoStatus/flow-state/current-plan.json` under the current working repository root.
- `target: "plan_scope"` uses the `additional_repositories` entries from that handoff file as the additional repository source of truth.
- `target: "plan_scope"` reads repository paths from `additional_repositories[].path`.
- If `current-plan.json` is missing, `target: "plan_scope"` behaves the same as `target: "working"`.
- If `current-plan.json` exists but `additional_repositories` is empty or absent, `target: "plan_scope"` behaves the same as `target: "working"`.
- If `current-plan.json` exists but is malformed, unreadable, or contains invalid or not-currently-ingested additional repositories, `target: "plan_scope"` continues with only the working repository instead of failing the whole step.
- `target: "plan_scope"` processes repositories in deterministic order: working repository first, then `additional_repositories` in file order.
- `target: "plan_scope"` de-duplicates repositories while preserving first occurrence order.
- If the working repository also appears inside `additional_repositories`, it is treated as redundant and ignored there.
- Existing re-ingest blocking semantics remain intact for both new targets: the step waits for terminal outcomes before continuing.
- `target: "plan_scope"` records one structured batch result payload covering all repositories it attempted, rather than emitting unrelated single-repository transcript items.
- `target: "plan_scope"` reuses the existing batch transcript payload shape used by multi-repository re-ingest, rather than introducing a second plan-scope-only batch payload.
- The batch result for `target: "plan_scope"` contains the ordered list of repositories attempted and the terminal outcome for each repository.
- The batch result for `target: "plan_scope"` also contains summary counts so the UI and tests can assert the batch outcome directly.
- Logs and structured runtime metadata clearly distinguish `sourceId`, `working`, and `plan_scope` target modes.
- Logs also make it clear when `plan_scope` had to ignore unusable `current-plan.json` data and continue with only the working repository.
- API validation, docs, tests, and planning references are updated so `current` is no longer presented as a supported re-ingest target.

### Out Of Scope

- Keeping `current` as a backwards-compatible alias for the new working-repository behavior.
- Reworking the meaning of `working_folder` outside what is required for re-ingest targeting.
- Replacing explicit `sourceId`-based re-ingest with a new universal selector contract.
- Changing unrelated markdown-step behavior, flow lookup rules, or command-resolution rules outside what is required for the new targets.
- Reworking the broader `current-plan.json` handoff format beyond reading `additional_repositories[].path` for this story.
- General multi-repository orchestration features beyond the `plan_scope` re-ingest behavior described here.

### Additional Repositories

- No Additional Repositories

### Questions

1. How should commands and flows that still use the removed `target: "current"` literal fail once this story lands?
   - Why this is important: this decides whether old workflow files silently change meaning or stop with a visible migration signal. Because `current` used to mean "owner repository", aliasing it to `working` would change behavior in a way that is easy to miss.
   - Best Answer: removed `current` values should fail validation or pre-start checks with a clear migration message that tells authors to use `working` for the selected `working_folder` repository or `plan_scope` for working repository plus `current-plan.json` scope. This is the best answer because the story intentionally removes `current` instead of redefining it in place, and both the repository plan and Zod-style schema validation favor explicit invalid-literal failures unless the code deliberately adds an alias or transform.
   - Where this answer came from: this story's own Description, Acceptance Criteria, and Out Of Scope sections; the existing single-target payload/lifecycle code in `server/src/chat/reingestToolResult.ts` and `server/src/chat/reingestStepLifecycle.ts`, which still special-case `current`; repository planning precedent around contract cleanup in `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`; and external schema-validation references from Zod docs and DeepWiki showing that removed enum or literal values fail validation unless an explicit transform or fallback is introduced.

2. How should `plan_scope` surface additional repositories that were listed in `current-plan.json` but were ignored because the handoff was malformed, unreadable, invalid, or not currently ingested?
   - Why this is important: this decides whether users and tests can understand why `plan_scope` fell back to the working repository only, without forcing the story to invent a second batch payload contract.
   - Best Answer: `plan_scope` should keep using the existing batch transcript payload shape for the repositories it actually attempted, while surfacing ignored or unusable extra repositories through structured logs and step metadata attached to target resolution. This is the best answer because the story already decided to reuse the existing batch payload shape, and the repository already uses logs plus metadata to explain re-ingest batch behavior without overloading the transcript contract with every intermediate resolution detail.
   - Where this answer came from: the accepted Decisions already recorded in this story; `server/src/chat/reingestToolResult.ts`, which records `targetMode`, payload kind, and repository counts in structured logs; `server/src/chat/reingestStepLifecycle.ts`, which normalizes and persists batch result payloads; and repository handoff documentation in `codeinfo_markdown/store_current_plan_handoff.md` and `codeinfo_markdown/review_evidence_gate.md`, which already treat the current repository as implicit and extra repositories as a derived handoff scope rather than a second primary contract.

3. Should this story also change the MCP `reingest_repository` tool so it understands `working` or `plan_scope`, or should those new target modes stay scoped to commands and flows only?
   - Why this is important: this decides whether the work remains a workflow-targeting story or expands into a public MCP contract change with its own compatibility and documentation burden.
   - Best Answer: keep `working` and `plan_scope` scoped to commands and flows only, and leave MCP `reingest_repository` on its existing explicit `sourceId` contract for this story. This is the best answer because the new modes depend on run-scoped concepts such as `working_folder` and the current plan handoff, while the MCP tool is currently documented and validated as an explicit repository-selector operation. Extending MCP would be a separate contract change rather than an automatic consequence of the workflow-targeting cleanup in this story.
   - Where this answer came from: this story's Description and Acceptance Criteria, which preserve explicit `sourceId` support while talking only about command and flow re-ingest surfaces; `docs/developer-reference.md`, which documents `reingest_repository` as `sourceId`-driven and compatibility-sensitive; `planning/0000045-command-flow-reingest-and-codeinfo-markdown-steps.md`, which established the explicit-selector re-ingest contract; and external MCP SDK/spec references showing that tool inputs are defined by explicit schemas and that changing tool arguments is an intentional contract update, not something implied by unrelated workflow features.

## Decisions

1. Continue with only the working repository when `current-plan.json` cannot be fully used.
   - Question being addressed: If `current-plan.json` exists but is malformed, unreadable, or contains `additional_repositories` entries that are invalid or not currently ingested, should `plan_scope` fail fast before the step starts, or should it continue with only the working repository?
   - Why the question matters: this decides whether a damaged or stale handoff blocks the user's main re-ingest action or only limits the extra repository scope.
   - What the answer is: continue with only the working repository.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it keeps the primary user intent working even when the extra handoff scope is stale, while still allowing logs and tests to surface that the additional repositories were ignored.

2. Reuse the existing batch transcript payload shape for `plan_scope`.
   - Question being addressed: Should `plan_scope` reuse the existing multi-repository batch transcript payload shape from earlier re-ingest work as-is, or should this story define a narrower batch payload tailored specifically to working-repo plan scope?
   - Why the question matters: this decides whether `plan_scope` stays on the existing multi-repository UI/storage/test path or introduces a second special-purpose batch contract.
   - What the answer is: reuse the existing batch transcript payload shape.
   - Where the answer came from: direct user answer in this planning conversation after follow-up explanation.
   - Why it is the best answer: `plan_scope` is still a batch re-ingest of several repositories, so reusing the current batch payload keeps the runtime, transcript rendering, persistence, and tests simpler while still exposing the selected mode through `targetMode: "plan_scope"`.

## Implementation Ideas

- Replace the current owner-based `current` target in the command and flow schemas with `working` and `plan_scope`, while keeping explicit `sourceId` support.
- Extend the re-ingest execution layer so it accepts the validated `working_folder` repository path directly instead of only the current owner repository path.
- Add one resolver for `plan_scope` that:
  - starts with the current working repository;
  - reads `<working-repo>/codeInfoStatus/flow-state/current-plan.json` when present;
  - extracts `additional_repositories[].path`;
  - de-duplicates the final ordered list.
- Reuse the existing repository selector and canonical container-path normalization logic when turning working-repository and plan-scope entries into re-ingestable roots.
- Keep `working` as a single-repository execution path and `plan_scope` as a batch orchestration path that records the existing structured batch result shape with `targetMode: "plan_scope"`.
- Update direct command execution, dedicated flow re-ingest steps, and flow-command re-ingest items together so all three surfaces share the same target semantics.
- Update logs, tool-result payloads, and persisted step metadata so the selected target mode and resolved repository list are obvious during debugging, including when unusable handoff data forces `plan_scope` to fall back to the working repository only.
- Add tests for:
  - schema acceptance and rejection of `working`, `plan_scope`, and removed `current`;
  - `working` with and without a valid `working_folder`;
  - `plan_scope` with no handoff file;
  - `plan_scope` with empty `additional_repositories`;
  - `plan_scope` with multiple repositories and duplicate entries;
  - invalid handoff-file scenarios that prove the step continues with only the working repository.
