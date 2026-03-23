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

If `current-plan.json` exists but is malformed or unreadable, `plan_scope` should not fail the whole step. Instead, it should continue with only the working repository and emit enough structured logging to make it clear that the handoff could not be fully used. If the handoff file can be read but some additional repositories are invalid or not currently ingested, those entries should be skipped with warnings while the remaining usable repositories still run.

The repository already uses `current-plan.json` as a canonical handoff file for multi-repository story scope. That handoff names extra repositories through `additional_repositories`, while the current repository is implicit. This story reuses that same product language rather than inventing a second related-repositories concept. The current plan-scope re-ingest should therefore read the same `additional_repositories[].path` values already used elsewhere in the repository's workflow assets.

This story is also a contract cleanup. The `current` re-ingest target should be removed rather than kept as a second name for a different meaning. Leaving `current` in place would preserve a word that already means the wrong thing in both planning and code, which would keep the product confusing for workflow authors.

This cleanup should also update any checked-in commands or flows in the repository that still reference `target: "current"`. Those checked-in assets should move to `target: "plan_scope"` as part of this story so the repository's own workflow configuration matches the new supported contract immediately.

Once `current` is removed, it should not keep any dedicated compatibility branch. Any inaccurate or unsupported target value, including the removed `current` literal, should fail the same way through the normal schema or validation path used for invalid target values generally.

This story does not remove explicit `sourceId`-based re-ingest. Users should still be able to target one specific repository by selector when they want exact control. The purpose of this story is to make the common workflow cases read naturally:

- `working` for "the repository I am working in right now";
- `plan_scope` for "the repository I am working in right now plus the related repositories declared by the current plan handoff".

The runtime should preserve deterministic behavior for `plan_scope`. Repository order should be:

1. the current working repository;
2. then repositories listed in `current-plan.json.additional_repositories` in file order.

Duplicate repositories should be removed while preserving the first occurrence. If the current working repository is also listed in `additional_repositories`, that duplicate should be ignored. If the same additional repository appears more than once, only the first occurrence should be kept.

Because `plan_scope` can touch more than one repository, it should behave like a small batch operation rather than a set of disconnected single-repository tool events. It should block until every targeted repository reaches a terminal outcome, and it should record one structured batch result that the UI, logs, and tests can reason about. This keeps the user experience aligned with the existing direction for multi-repository re-ingest work.

This story should reuse the existing batch transcript payload shape that already exists for multi-repository re-ingest. `plan_scope` is still a batch re-ingest of multiple repositories, so it should travel through the same general payload contract rather than inventing a second special-purpose batch result. The runtime should extend that existing shape by allowing `targetMode: "plan_scope"` and by populating the same ordered `repositories` array and `summary` counts already used by the current batch path.

Best-effort execution is important for `plan_scope`. If the handoff file cannot be read well enough to produce additional repository scope, the batch should still continue with the working repository and log a warning. If some additional repository entries are invalid or not currently ingested, they should be skipped with warnings while the remaining usable repositories still run. Those skipped-at-resolution repositories should be surfaced through warnings, structured logs, and step metadata rather than being inserted into the attempted-repository batch payload. If a repository begins re-ingest and later reaches a failed terminal outcome, that warning should be recorded but the batch must continue through the rest of the resolved repository list instead of stopping early.

### Acceptance Criteria

- Command JSON no longer supports `target: "current"` for re-ingest items.
- Flow JSON no longer supports `target: "current"` for re-ingest steps.
- Checked-in commands and flows in this repository that previously used `target: "current"` are updated to use `target: "plan_scope"` where that matches the desired behavior.
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
- If `current-plan.json` exists but is malformed or unreadable, `target: "plan_scope"` continues with only the working repository instead of failing the whole step.
- If `current-plan.json` contains invalid or not-currently-ingested additional repositories, `target: "plan_scope"` skips those entries with warnings and still attempts the remaining usable repositories.
- `target: "plan_scope"` processes repositories in deterministic order: working repository first, then `additional_repositories` in file order.
- `target: "plan_scope"` de-duplicates repositories while preserving first occurrence order.
- If the working repository also appears inside `additional_repositories`, it is treated as redundant and ignored there.
- Existing re-ingest blocking semantics remain intact for both new targets: the step waits for terminal outcomes before continuing.
- `target: "plan_scope"` does not abort the batch when one attempted repository reaches a failed terminal re-ingest outcome; it continues through the rest of the resolved repository list and records warnings for failures.
- `target: "plan_scope"` records one structured batch result payload covering all repositories it attempted, rather than emitting unrelated single-repository transcript items.
- `target: "plan_scope"` reuses the existing batch transcript payload shape used by multi-repository re-ingest, rather than introducing a second plan-scope-only batch payload.
- The batch result for `target: "plan_scope"` contains the ordered list of repositories attempted and the terminal outcome for each repository.
- The batch result for `target: "plan_scope"` also contains summary counts so the UI and tests can assert the batch outcome directly.
- Additional repositories that are skipped before re-ingest begins because they are invalid or not currently ingested do not appear in the batch `repositories` array or summary counts.
- Logs and structured runtime metadata clearly distinguish `sourceId`, `working`, and `plan_scope` target modes.
- Logs also make it clear when `plan_scope` had to fall back to the working repository only, skip unusable additional repositories, or continue after repository-level failures.
- Warning text, structured logs, and step metadata make skipped-at-resolution repositories visible even though they are not part of the attempted-repository batch payload.
- Unsupported target values, including the removed `current` literal, fail through the normal invalid-target validation path rather than a special backwards-compatibility branch.
- MCP `reingest_repository` remains on its explicit `sourceId` contract and does not gain `working` or `plan_scope` semantics in this story.
- API validation, docs, tests, and planning references are updated so `current` is no longer presented as a supported re-ingest target.

### Out Of Scope

- Keeping `current` as a backwards-compatible alias for the new working-repository behavior.
- Reworking the meaning of `working_folder` outside what is required for re-ingest targeting.
- Replacing explicit `sourceId`-based re-ingest with a new universal selector contract.
- Changing unrelated markdown-step behavior, flow lookup rules, or command-resolution rules outside what is required for the new targets.
- Reworking the broader `current-plan.json` handoff format beyond reading `additional_repositories[].path` for this story.
- General multi-repository orchestration features beyond the `plan_scope` re-ingest behavior described here.
- Expanding the MCP `reingest_repository` tool contract beyond its existing explicit `sourceId` behavior.

### Additional Repositories

- No Additional Repositories

### Questions

1. When `plan_scope` continues past per-repository failures, should the overall re-ingest tool result still be marked as an error, or should it be treated as success-with-warnings?
   - Why this is important: the current batch re-ingest path marks the whole tool result as `error` whenever any repository lands in the `failed` summary bucket, which could make a best-effort `plan_scope` run look like a hard failure in the UI even though the batch intentionally continued and completed the rest of its work.
   - Best Answer: `plan_scope` should be treated as success-with-warnings when the batch starts successfully and completes its ordered repository pass, even if some repositories fail within that pass. Per-repository failures should still be visible in the batch payload summary, assistant-turn wording, and structured logs, but the overall batch should not be marked as a hard error unless the batch cannot start at all. This is the best answer because the story already commits to "do not crash or stop or fail" batch behavior, while the current `summary.failed > 0 => error` rule was designed before that product decision. Local repo evidence shows the current stage decision is centralized in the re-ingest tool-result builder, and external MCP guidance also distinguishes successful tool calls with structured results from true protocol-level failures.
   - Where this answer came from: `server/src/chat/reingestToolResult.ts`, where `toToolStage(...)` currently flips any batch with `summary.failed > 0` to `error`; `server/src/chat/reingestStepLifecycle.ts`, which already renders user-facing batch summary text from counts; the current story decisions and acceptance criteria requiring best-effort continuation with warnings; repo precedent from `code_info` on keeping warnings in logs/metadata instead of aborting the step; and MCP TypeScript SDK / Model Context Protocol docs showing that recoverable tool execution problems are reported inside normal tool results rather than as protocol-level failures.

## Decisions

1. Use best-effort `plan_scope` execution instead of failing the whole batch.
   - Question being addressed: How should `plan_scope` behave when `current-plan.json` is malformed, unreadable, contains invalid or not-currently-ingested entries, or when one attempted repository later fails during re-ingest?
   - Why the question matters: this decides whether damaged handoff data or one bad repository stops the entire multi-repository action, or whether the user still gets as much useful re-ingest work as possible from the batch.
   - What the answer is: always use best effort and do not fail the whole batch for those cases. If the handoff file is malformed or unreadable, continue with the working repository only and log a warning. If some additional repository entries are invalid or not currently ingested, skip those entries with warnings and continue with the remaining usable repositories. If one attempted repository later reaches a failed terminal re-ingest outcome, continue through the rest of the batch and log a warning for the failure.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it preserves the main intent of re-ingesting the relevant scope now, while keeping failures visible in logs and batch results instead of turning one broken repository into a hard stop for the whole plan-scope action.

2. Reuse the existing batch transcript payload shape for `plan_scope`.
   - Question being addressed: Should `plan_scope` reuse the existing multi-repository batch transcript payload shape from earlier re-ingest work as-is, or should this story define a narrower batch payload tailored specifically to working-repo plan scope?
   - Why the question matters: this decides whether `plan_scope` stays on the existing multi-repository UI/storage/test path or introduces a second special-purpose batch contract.
   - What the answer is: reuse the existing batch transcript payload shape.
   - Where the answer came from: direct user answer in this planning conversation after follow-up explanation.
   - Why it is the best answer: `plan_scope` is still a batch re-ingest of several repositories, so reusing the current batch payload keeps the runtime, transcript rendering, persistence, and tests simpler while still exposing the selected mode through `targetMode: "plan_scope"`.

3. Update checked-in `current` references to `plan_scope` and remove special handling for removed targets.
   - Question being addressed: How should commands and flows that still use the removed `target: "current"` literal fail once this story lands?
   - Why the question matters: this decides whether old checked-in workflow files are migrated as part of the story and whether removed `current` values take a special compatibility path or fail like any other invalid target.
   - What the answer is: any checked-in commands and flows in this repository that still reference `target: "current"` should be updated to `target: "plan_scope"` as part of this story. After the contract is changed, any remaining inaccurate target value, including `current`, should fail the same way as any other invalid target with no special-case fallback logic.
   - Where the answer came from: direct user answer in this planning conversation.
   - Why it is the best answer: it keeps the repository's own assets aligned with the new supported contract, avoids hidden behavior changes, and simplifies implementation by removing dedicated compatibility behavior for a target that is intentionally being deleted.

4. Keep `working` and `plan_scope` scoped to commands and flows only.
   - Question being addressed: Should this story also change the MCP `reingest_repository` tool so it understands `working` or `plan_scope`, or should those new target modes stay scoped to commands and flows only?
   - Why the question matters: this decides whether the story remains a workflow-targeting cleanup or expands into a public MCP contract change.
   - What the answer is: keep the new target modes scoped to commands and flows only, and leave MCP `reingest_repository` on its existing explicit `sourceId` contract.
   - Where the answer came from: direct user answer in this planning conversation, agreeing with the previously documented best answer.
   - Why it is the best answer: it keeps the story focused on the workflow surfaces that actually have `working_folder` and current-plan context, while avoiding a separate MCP contract expansion.

5. Keep skipped-at-resolution repositories out of the attempted batch payload.
   - Question being addressed: If `plan_scope` skips additional repositories before re-ingest begins because they are invalid or not currently ingested, should those skipped-at-resolution repositories appear inside the batch `repositories` array, or only in warnings/logs/metadata?
   - Why the question matters: this decides whether the reused batch payload stays limited to repositories that were actually attempted, or whether the story quietly expands that payload contract to represent resolution-time skips as synthetic repository results.
   - What the answer is: keep the batch `repositories` array and `summary` limited to repositories that were actually attempted, and surface skipped-at-resolution repositories through warning text, structured logs, and step metadata instead.
   - Where the answer came from: direct user answer in this planning conversation, accepting the previously documented best answer.
   - Why it is the best answer: it preserves the existing batch payload contract, matches the current execution flow that only records attempted repositories, and keeps scope-discovery warnings separate from terminal re-ingest outcomes.

## Implementation Ideas

- Replace the current owner-based `current` target in the command and flow schemas with `working` and `plan_scope`, while keeping explicit `sourceId` support.
- Update any checked-in flow or command JSON that still uses `target: "current"` so it now uses `target: "plan_scope"`.
- Extend the re-ingest execution layer so it accepts the validated `working_folder` repository path directly instead of only the current owner repository path.
- Add one resolver for `plan_scope` that:
  - starts with the current working repository;
  - reads `<working-repo>/codeInfoStatus/flow-state/current-plan.json` when present;
  - extracts `additional_repositories[].path`;
  - de-duplicates the final ordered list;
  - skips unusable additional entries with warnings when partial resolution is still possible.
- Reuse the existing repository selector and canonical container-path normalization logic when turning working-repository and plan-scope entries into re-ingestable roots.
- Keep `working` as a single-repository execution path and `plan_scope` as a batch orchestration path that records the existing structured batch result shape with `targetMode: "plan_scope"`, while continuing through later repositories when one attempted re-ingest fails.
- Update direct command execution, dedicated flow re-ingest steps, and flow-command re-ingest items together so all three surfaces share the same target semantics.
- Let unsupported targets, including removed `current`, fail through the normal invalid-target schema or validation path instead of a dedicated compatibility branch.
- Update logs, tool-result payloads, and persisted step metadata so the selected target mode and resolved repository list are obvious during debugging, including when unusable handoff data forces `plan_scope` to fall back to the working repository only, skip specific repositories, or continue after repository-level failures.
- Add tests for:
  - schema acceptance and rejection of `working`, `plan_scope`, and removed `current`;
  - checked-in commands and flows that are migrated from `current` to `plan_scope`;
  - `working` with and without a valid `working_folder`;
  - `plan_scope` with no handoff file;
  - `plan_scope` with empty `additional_repositories`;
  - `plan_scope` with multiple repositories and duplicate entries;
  - malformed handoff-file scenarios that prove the step continues with only the working repository;
  - partially invalid repository lists that prove bad entries are skipped while good entries still run, and that skipped-at-resolution repositories are visible through warnings/metadata rather than the attempted batch payload;
  - multi-repository batches where one repository fails and later repositories still continue.
