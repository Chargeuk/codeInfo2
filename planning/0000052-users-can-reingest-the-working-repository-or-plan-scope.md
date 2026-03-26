# Story 0000052 – Users can reingest the working repository or plan scope

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Commands and flows already support a dedicated re-ingest step, but the current targeting language no longer matches how the product is actually used. The existing `current` target means "the repository that owns the flow or command file". That is technically definable, but it is not what the user wants. The user works from a selected `working_folder` repository and wants re-ingest actions to operate on that selected repository instead.

This story replaces the confusing owner-based `current` target with two targets that match the real workflow model.

It also removes the broader `all` batch literal from command and flow authoring. Users who want explicit one-repository control should keep using `sourceId`, and users who want the working repository plus its declared related repositories should use `plan_scope`.

The first target is `working`. This means "re-ingest the repository currently selected as the run's `working_folder`". It should work the same way for direct commands, dedicated flow re-ingest steps, and command items executed inside flows. If no working repository is selected, or if the selected working repository is not currently ingested, the step should fail before it starts with a clear error.

The second target is `plan_scope`. This means "re-ingest the current working repository and any additional repositories declared in that repository's `codeInfoStatus/flow-state/current-plan.json` file". The current repository always comes first. If the handoff file is missing, or if it exists but has no `additional_repositories`, then `plan_scope` should behave the same as `working`.

`plan_scope` still depends on the working repository being usable. If no working repository is selected, or if the selected working repository is not currently ingested, the batch must fail before it starts for the same reason as `working`. The handoff fallback rules only apply after the working repository itself has been validated and accepted as the first repository in scope.

If `current-plan.json` exists but is malformed or unreadable, `plan_scope` should not fail the whole step. Instead, it should continue with only the working repository and emit enough structured logging to make it clear that the handoff could not be fully used. If the handoff file can be read but some additional repositories are invalid or not currently ingested, those entries should be skipped with warnings while the remaining usable repositories still run.

The repository already uses `current-plan.json` as a canonical handoff file for multi-repository story scope. That handoff names extra repositories through `additional_repositories`, while the current repository is implicit. This story reuses that same product language rather than inventing a second related-repositories concept. The current plan-scope re-ingest should therefore read the same `additional_repositories[].path` values already used elsewhere in the repository's workflow assets.

This story is also a contract cleanup. The old `current` and `all` re-ingest targets should be removed rather than kept as alternate names for different behavior. Leaving those literals in place would preserve outdated wording that no longer matches the intended workflow model, which would keep the product confusing for workflow authors.

This cleanup should also update any checked-in commands or flows in the repository that still reference `target: "current"`. Those checked-in assets should move to `target: "plan_scope"` as part of this story so the repository's own workflow configuration matches the new supported contract immediately.

Once `current` is removed, it should not keep any dedicated compatibility branch. Any inaccurate or unsupported target value, including the removed `current` literal, should fail the same way through the normal schema or validation path used for invalid target values generally.

This story does not remove explicit `sourceId`-based re-ingest. Users should still be able to target one specific repository by selector when they want exact control. The purpose of this story is to make the common workflow cases read naturally:

- `working` for "the repository I am working in right now";
- `plan_scope` for "the repository I am working in right now plus the related repositories declared by the current plan handoff".

The runtime should preserve deterministic behavior for `plan_scope`. Repository order should be:

1. the current working repository;
2. then repositories listed in `current-plan.json.additional_repositories` in file order.

Duplicate repositories should be removed while preserving the first occurrence. If the current working repository is also listed in `additional_repositories`, that duplicate should be skipped as redundant. If the same additional repository appears more than once, only the first occurrence should be kept and later duplicates should be surfaced as skipped-at-resolution warnings so the user can see that the handoff contained redundant scope entries.

Because `plan_scope` can touch more than one repository, it should behave like a small batch operation rather than a set of disconnected single-repository tool events. It should block until every targeted repository reaches a terminal outcome, and it should record one structured batch result that the UI, logs, and tests can reason about. This keeps the user experience aligned with the existing direction for multi-repository re-ingest work.

This story should reuse the existing batch transcript payload shape that already exists for multi-repository re-ingest. `plan_scope` is still a batch re-ingest of multiple repositories, so it should travel through the same general payload contract rather than inventing a second special-purpose batch result. The runtime should extend that existing shape only as needed for this story by allowing `targetMode: "plan_scope"`, keeping the same ordered `repositories` array and `summary` counts, and adding warning data for plan-scope-specific fallback and skip cases.

Best-effort execution is important for `plan_scope`. If the handoff file cannot be read well enough to produce additional repository scope, the batch should still continue with the working repository and log a warning. If some additional repository entries are invalid or not currently ingested, they should be skipped with warnings while the remaining usable repositories still run. Those skipped-at-resolution repositories should be surfaced through warnings, structured logs, and step metadata rather than being inserted into the attempted-repository batch payload. If a repository begins re-ingest and later reaches a failed terminal outcome, that warning should be recorded but the batch must continue through the rest of the resolved repository list instead of stopping early. When that happens, the overall `plan_scope` batch should be reported as completed with warnings rather than as a hard error, because the batch itself still finished its full ordered pass.

### Definitions and runtime rules

- **Working repository** means the repository resolved from the run's current `working_folder` value after it passes through the same repository-resolution logic already used elsewhere in the product. This story does not invent a second way to resolve repositories.
- **Currently ingested repository** means a repository that the existing repository selector / ingest lookup layer can already resolve to an ingested root and use for a normal explicit `sourceId`-style re-ingest. If that existing lookup says the repository is unknown or not ingested, `working` must fail before starting and `plan_scope` must skip that additional repository with a warning.
- **Direct command execution** means a re-ingest item executed from a command file without a flow wrapper.
- **Dedicated flow re-ingest step** means a top-level flow step whose purpose is re-ingest.
- **Flow-command re-ingest item** means a re-ingest item inside a command that is itself being executed by a flow step.
- **Attempted repository** means a repository for which the runtime actually started a re-ingest run. Repositories rejected earlier during scope resolution are not "attempted repositories".
- **Skipped-at-resolution repository** means an additional repository named in `current-plan.json` that is ignored before re-ingest starts because its path is invalid, unreadable, duplicated, or not currently ingested.
- **Success-with-warnings** means the batch itself started, processed every repository it was able to attempt in order, and reached a terminal batch result, but one or more warnings were recorded. Those warnings may come from handoff fallback, skipped-at-resolution repositories, or repository-level re-ingest failures.
- `plan_scope` repository resolution order is fixed:
  1. resolve the working repository first;
  2. read `<working-repo>/codeInfoStatus/flow-state/current-plan.json` if present and readable enough to parse;
  3. append `additional_repositories[].path` entries in file order;
  4. drop duplicates while keeping the first occurrence;
  5. skip unusable additional repositories with warnings;
  6. attempt the remaining repositories in final order.
  7. if `additional_repositories` is absent or an empty array, continue with a clean working-only batch and no handoff warning;
  8. if `additional_repositories` exists but is not a usable array of `{ path }` objects, treat the handoff as invalid and fall back to working-only with `handoff_invalid`.

### Result and warning contract

- `working` remains a single-repository re-ingest and should continue to use the same single-repository result shape that the product already uses for explicit selector-based re-ingest.
- `plan_scope` must reuse the existing multi-repository batch result shape rather than inventing a new one. At minimum, the runtime must continue to populate:
  - `targetMode`, now allowing the literal `"plan_scope"`;
  - `repositories`, ordered exactly as attempted;
  - `summary`, with counts derived only from attempted repositories.
- Each attempted repository entry in the batch result must represent one repository that actually started re-ingest and must include that repository's terminal outcome.
- Skipped-at-resolution repositories must not be synthesized into the `repositories` array. They belong in warnings, structured logs, or step metadata instead.
- When `plan_scope` falls back to the working repository only because the handoff file is missing, malformed, unreadable, or structurally invalid, the batch still succeeds if that working-repository re-ingest succeeds. The warning should explain why no additional repositories were attempted.
- When `plan_scope` reads a valid handoff file whose `additional_repositories` field is absent or empty, the batch should behave as a clean working-only run with no handoff warning because the handoff itself was usable and simply contributed no extra repository scope.
- When `plan_scope` starts successfully and one attempted repository later fails, the batch must continue through later attempted repositories and finish with a warning-style terminal status rather than aborting the whole batch at the first failed repository.
- Unsupported target values, including removed `current` and removed `all`, must fail during normal schema or validation handling before any re-ingest run starts. This story should not add a compatibility-only branch that rewrites old target values at runtime.

### Developer-facing implementation boundary

- The same target semantics must be implemented in exactly three places and kept aligned:
  - direct command re-ingest items;
  - dedicated flow re-ingest steps;
  - re-ingest items inside commands executed by flows.
- MCP `reingest_repository` is explicitly outside this contract change. It should stay selector-driven and should not gain `working` or `plan_scope` parsing, fallback, or plan-handoff behavior.
- Checked-in workflow assets in this repository are part of the story output. If a checked-in command or flow still uses `target: "current"`, updating that asset is part of completing the story, not optional cleanup.

## Message Contracts and Storage Shapes

This story stays within the current repository, so the contract definitions below use the normal single-repository style. The story does change existing contracts and one stored payload shape, but it should do so by extending the current command/flow/tool-result path rather than inventing a second persistence channel.

### Authored command and flow JSON contracts

- Command JSON re-ingest items should be defined as exactly one of:
  - `{ "type": "reingest", "sourceId": "<selector>" }`
  - `{ "type": "reingest", "target": "working" }`
  - `{ "type": "reingest", "target": "plan_scope" }`
- Flow JSON re-ingest steps should be defined as exactly one of:
  - `{ "type": "reingest", "sourceId": "<selector>" }`
  - `{ "type": "reingest", "target": "working" }`
  - `{ "type": "reingest", "target": "plan_scope" }`
- `target: "current"` and `target: "all"` are removed from newly-authored command and flow files in this story. They are not compatibility aliases.
- Contract owner and parser files:
  - `server/src/agents/commandsSchema.ts`
  - `server/src/flows/flowSchema.ts`
- Compatibility expectation:
  - new checked-in command and flow files written by this story must use only `sourceId`, `working`, or `plan_scope`;
  - remaining `current`/`all` authored values should fail the normal invalid-target path rather than being rewritten at runtime.

### Runtime re-ingest execution result contract

- `server/src/ingest/reingestExecution.ts` should keep two result families:
  - single-repository result for `sourceId` and `working`;
  - batch result for `plan_scope`.
- The single result contract should be:
  - `kind: "single"`
  - `targetMode: "sourceId" | "working"`
  - `requestedSelector: string | null`
  - `resolvedSourceId: string`
  - `outcome: ReingestSuccess`
- The batch result contract should remain attempted-repository-oriented and should be:
  - `kind: "batch"`
  - `targetMode: "plan_scope"`
  - `requestedSelector: null`
  - `repositories: ReingestRepositoryExecutionOutcome[]`
  - `summary: { reingested: number; skipped: number; failed: number }`
  - `warnings: ReingestPlanScopeWarning[]`
- `repositories` and `summary` must describe attempted repositories only.
- `warnings` must carry the resolution-time and best-effort context that the existing batch payload cannot express by repository outcomes alone.
- The warning shape should stay simple and explicit:
  - `code: "handoff_missing" | "handoff_invalid" | "repository_skipped" | "repository_failed"`
  - `message: string`
  - `repositoryPath?: string | null`
  - `resolvedRepositoryId?: string | null`
- Duplicate additional-repository entries, including duplicates of the working repository, should use the normal `repository_skipped` warning path rather than a separate duplicate-specific warning code.
- Compatibility expectation:
  - reuse the current repository-outcome entry shape instead of inventing a second per-repository result type;
  - do not synthesize skipped-at-resolution repositories into `repositories`.

### `current-plan.json` handoff storage contract

- This story reuses the existing checked-in handoff file instead of creating a new storage file.
- Runtime consumption should read:
  - `<working-repo>/codeInfoStatus/flow-state/current-plan.json`
  - `additional_repositories[].path`
- Runtime consumption should ignore handoff fields that are not needed for repository scope resolution, including `plan_path` and any `branched_from` values.
- This story does not redefine the handoff file format. It adds runtime consumption of the existing `additional_repositories[].path` field only.
- Compatibility expectation:
  - missing file or unreadable file must fall back to working-only behavior plus warnings;
  - malformed JSON or structurally invalid `additional_repositories` content must fall back to working-only behavior plus `handoff_invalid`;
  - empty or absent `additional_repositories` in an otherwise readable handoff file must fall back to working-only behavior without a handoff warning;
  - the story should not write or migrate this file during re-ingest execution.

### Chat tool-result and persisted turn storage contract

- `server/src/chat/reingestToolResult.ts` should keep the existing `tool-result` event path and the existing `reingest_step_result` / `reingest_step_batch_result` payload kinds.
- The single payload should become:
  - `targetMode: "sourceId" | "working"`
- The batch payload should become:
  - `targetMode: "plan_scope"`
  - `repositories: ReingestRepositoryExecutionOutcome[]`
  - `summary: { reingested: number; skipped: number; failed: number }`
  - `warnings: ReingestPlanScopeWarning[]`
- Because `ChatToolResultEvent.stage` currently only allows `success` or `error`, completed `plan_scope` batches with warnings should be represented as:
  - `stage: "success"`
  - batch payload `warnings.length > 0`
- `server/src/chat/reingestStepLifecycle.ts` should persist that batch payload unchanged into `Turn.toolCalls` so the warning information survives memory persistence, Mongo persistence, websocket publication, and later transcript reads.
- Storage shape owner:
  - `server/src/mongo/turn.ts` already stores `toolCalls` as `Schema.Types.Mixed`, so no new collection or top-level Turn schema field is needed for this story.
- Compatibility expectation:
  - new writes from this story should persist `working` and `plan_scope`;
  - stored historical payloads that still mention `sourceId`, `current`, or `all` should remain readable through the lifecycle normalization path where practical, but the story should not keep writing the removed literals.

### Acceptance Criteria

- Command JSON no longer supports `target: "current"` for re-ingest items.
- Flow JSON no longer supports `target: "current"` for re-ingest steps.
- Command JSON no longer supports `target: "all"` for re-ingest items.
- Flow JSON no longer supports `target: "all"` for re-ingest steps.
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
- If no `working_folder` is available for the run, `target: "plan_scope"` fails before the step starts with a clear validation or pre-start error.
- If the selected `working_folder` repository is not currently ingested, `target: "plan_scope"` fails before the step starts with a clear validation or pre-start error.
- `target: "plan_scope"` always includes the current working repository first.
- `target: "plan_scope"` reads extra repositories from `codeInfoStatus/flow-state/current-plan.json` under the current working repository root.
- `target: "plan_scope"` uses the `additional_repositories` entries from that handoff file as the additional repository source of truth.
- `target: "plan_scope"` reads repository paths from `additional_repositories[].path`.
- If `current-plan.json` is missing, `target: "plan_scope"` behaves the same as `target: "working"`.
- If `current-plan.json` exists but `additional_repositories` is empty or absent, `target: "plan_scope"` behaves the same as `target: "working"` without a handoff warning.
- If `current-plan.json` exists but is malformed or unreadable, `target: "plan_scope"` continues with only the working repository instead of failing the whole step.
- If `current-plan.json` is readable JSON but `additional_repositories` is not a usable array of `{ path }` entries, `target: "plan_scope"` treats the handoff as invalid, records `handoff_invalid`, and continues with only the working repository.
- If `current-plan.json` contains invalid or not-currently-ingested additional repositories, `target: "plan_scope"` skips those entries with warnings and still attempts the remaining usable repositories.
- `target: "plan_scope"` processes repositories in deterministic order: working repository first, then `additional_repositories` in file order.
- `target: "plan_scope"` de-duplicates repositories while preserving first occurrence order.
- If the working repository also appears inside `additional_repositories`, it is treated as redundant, skipped with `repository_skipped`, and not attempted twice.
- If the same additional repository appears more than once, later duplicates are dropped, surfaced as `repository_skipped`, and do not change the first occurrence order.
- Existing re-ingest blocking semantics remain intact for both new targets: the step waits for terminal outcomes before continuing.
- `target: "plan_scope"` does not abort the batch when one attempted repository reaches a failed terminal re-ingest outcome; it continues through the rest of the resolved repository list and records warnings for failures.
- When a `plan_scope` batch starts successfully and completes its full ordered pass, the overall tool result is reported as success-with-warnings rather than as a hard error, even if some repositories in the batch failed.
- `target: "plan_scope"` records one structured batch result payload covering all repositories it attempted, rather than emitting unrelated single-repository transcript items.
- `target: "plan_scope"` reuses the existing batch transcript payload shape used by multi-repository re-ingest, rather than introducing a second plan-scope-only batch payload.
- The batch result for `target: "plan_scope"` contains the ordered list of repositories attempted and the terminal outcome for each repository.
- The batch result for `target: "plan_scope"` also contains summary counts so the UI and tests can assert the batch outcome directly.
- The batch result for `target: "plan_scope"` also contains a `warnings` array that records handoff fallback, skipped-at-resolution repositories, and attempted repository failures.
- Additional repositories that are skipped before re-ingest begins because they are invalid or not currently ingested do not appear in the batch `repositories` array or summary counts.
- Completed `plan_scope` batches that include warnings are persisted and published with tool-result `stage: "success"` plus the batch `warnings` array, rather than a new tool stage enum value.
- Logs and structured runtime metadata clearly distinguish `sourceId`, `working`, and `plan_scope` target modes.
- Logs also make it clear when `plan_scope` had to fall back to the working repository only, skip unusable additional repositories, or continue after repository-level failures.
- Warning text, structured logs, and step metadata make skipped-at-resolution repositories visible even though they are not part of the attempted-repository batch payload.
- Warning-oriented assistant text and UI status make it clear when `plan_scope` completed with some repository failures, without treating the whole batch as a hard error.
- Runtime `plan_scope` consumption reads only `additional_repositories[].path` from `current-plan.json` and ignores unrelated handoff fields such as `plan_path` and `branched_from`.
- The story persists the new warning data through the existing `Turn.toolCalls` payload path and does not introduce a new Mongo collection or a new top-level Turn schema field.
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
- Adding a new tool-result stage enum value just for warning-style `plan_scope` completion.
- Introducing a new persistence collection or a new top-level Turn schema field for re-ingest warnings.

## Ground Rules For Juniors

- Work from the repository root unless a subtask explicitly says otherwise.
- Treat every subtask as standalone work: read every file in its `Read/update:` list and every link in its `Documentation:` list before you change code.
- Do not rely on later tasks to clarify the current one. If a subtask says to preserve or avoid something, handle that boundary inside that subtask before moving on.
- Keep implementation local to the files named in the subtask unless you discover a concrete dependency that must be added; if that happens, update this story file immediately so the dependency is written down for the next developer.
- Run the task’s listed verification steps before marking the task done, and record any deliberate no-change decision in that task’s Implementation notes so later developers do not have to guess why something was left alone.

## Research Findings

- Repository scope remains single-repository for this story. The active handoff file still points only at this repository and the plan's `Additional Repositories` section remains `- No Additional Repositories`.
- The current command and flow schemas still hard-code only three re-ingest request shapes:
  - explicit `sourceId`
  - `target: "current"`
  - `target: "all"`
    Repo evidence: `server/src/agents/commandsSchema.ts`, `server/src/flows/flowSchema.ts`, `server/src/ingest/reingestExecution.ts`, and `server/src/agents/commandsRunner.ts`.
- The runtime already has working-folder resolution that should be reused rather than reimplemented. Repo evidence:
  - `server/src/workingFolders/state.ts` validates absolute paths, known repository membership, and host-to-workdir mapping
  - `server/src/agents/service.ts` and `server/src/flows/service.ts` already resolve the effective `working_folder` for runs before command or flow execution starts
- `current-plan.json` is already a checked-in workflow handoff artifact, but server/client runtime code does not currently parse it during re-ingest execution. Story `0000052` therefore introduces new runtime consumption of that handoff file rather than reusing an existing runtime parser.
- The existing batch re-ingest execution already continues after per-repository failures for `target: "all"` and records per-repository outcomes, but the user-facing tool result layer still turns any batch with `summary.failed > 0` into hard `stage: "error"`. Repo evidence:
  - `server/src/ingest/reingestExecution.ts` continues the ordered batch after failures
  - `server/src/chat/reingestToolResult.ts` currently maps batch results with any failed repository to hard error stage
  - `server/src/chat/reingestStepLifecycle.ts` currently only accepts batch `targetMode: "all"`
- `server/src/ingest/reingestExecution.ts` does not currently accept a working-repository path input. The runtime task must therefore add an explicit execution input for the already-selected run `working_folder` before direct-command or flow wiring can use the new `working` target semantics.
- Flow-owned command re-ingest already splits responsibility across two files:
  - `server/src/agents/commandItemExecutor.ts` owns command-item log/delegation behavior only
  - `server/src/flows/service.ts` owns the callback that actually calls `executeReingestRequest`
    The flow-wiring tasks must keep that boundary explicit instead of asking a developer to add a new direct execution path inside `commandItemExecutor.ts`.
- The current execution layer does not have an existing "zero attempted repositories" runtime guard to preserve. Story work should therefore prove the real contracts that exist: pre-start failure when the working repository is unusable, warning-only fallback when the handoff is unusable, and continue-after-failure behavior once a `plan_scope` batch has started.
- The summary wrappers and targeted proof commands already exist for the main validation paths:
  - `package.json` already exposes `build:summary:server`, `build:summary:client`, `compose:build:summary`, `compose:up`, `compose:down`, `test:summary:server:unit`, and `test:summary:e2e`
  - `scripts/test-summary-server-unit.mjs` already supports repeatable `--file` targeting for the planned unit and integration suites
  - `scripts/docker-compose-with-env.sh` already creates optional local env files when absent, so the compose wrappers themselves are runnable without hand-creating blank `.env.local` files first
- The main compose stack already mounts `${CODEINFO_HOST_INGEST_DIR}` into `${CODEINFO_CODEX_WORKDIR}` in `docker-compose.yml`, so the mounted-runtime proof can use the main stack once the story provides one checked-in re-ingest command or flow asset that is safe to invoke there.
- The repository does not currently contain any checked-in command or flow asset that executes a re-ingest step. A later compose-proof task therefore cannot rely on an existing named command or flow unless this story creates one deliberately earlier in the sequence.
- The current `all` target sorts repositories by canonical path order before execution. Story `0000052` deliberately changes that behavior for `plan_scope` to a different deterministic order: working repository first, then `additional_repositories` in handoff file order.
- Current checked-in JSON command and flow assets in this repository do not appear to contain `target: "current"` or `target: "all"` literals today; the references found during research are in runtime code and tests. That means the acceptance about updating checked-in assets should be implemented as:
  - verify by search whether any checked-in workflow assets still use removed targets;
  - update them if found;
  - otherwise record that the acceptance was satisfied by verification because no checked-in assets required migration at implementation time.
- Current tests already cover:
  - schema acceptance/rejection for `current` and `all`
  - direct command `current` owner resolution
  - `all` batch ordering and continue-after-failure behavior
  - flow-command and flow-step re-ingest parsing
    That existing coverage should be updated rather than duplicated where possible.

## Operational Prerequisites and Missing Capabilities

- **No new HTTP listener is required for this story.**
  - Repo evidence: the main server already starts from `server/src/index.ts`, and Compose health checks already target `GET /health`.
  - Planning implication: Story `0000052` should reuse the existing server listener and `/health` endpoint rather than planning a new readiness route just for plan-scope re-ingest.

- **The runtime does not yet have a `current-plan.json` reader in the re-ingest path.**
  - Repo evidence: `current-plan.json` is currently a workflow handoff artifact, but the re-ingest execution/runtime files do not parse it today.
  - Missing capability: Story `0000052` must add a runtime seam that safely reads `<working-repo>/codeInfoStatus/flow-state/current-plan.json`, extracts `additional_repositories[].path`, and turns resolution failures into warnings instead of hard failures where required by the story.

- **Warning-style batch completion does not yet exist in the re-ingest tool-result layer.**
  - Repo evidence:
    - `server/src/ingest/reingestExecution.ts` already continues batch execution after per-repository failures for `target: "all"`;
    - `server/src/chat/reingestToolResult.ts` still maps any batch with `summary.failed > 0` to hard tool stage `error`;
    - `server/src/chat/reingestStepLifecycle.ts` still only recognizes batch `targetMode: "all"`.
  - Missing capability: Story `0000052` must extend both the user-facing tool-result layer and the lifecycle validation/persistence layer so `plan_scope` can finish as success-with-warnings instead of being forced into a hard error state.

- **Container access to `<working-repo>/codeInfoStatus/flow-state/current-plan.json` depends on existing host-to-container bind mounts.**
  - Repo evidence:
    - `docker-compose.yml` and `docker-compose.local.yml` mount `${CODEINFO_HOST_INGEST_DIR}` into `${CODEINFO_CODEX_WORKDIR}`;
    - `docker-compose.e2e.yml` does not mount the host ingest root into the server container;
    - working-folder validation/path mapping already depends on `CODEINFO_HOST_INGEST_DIR` and `CODEINFO_CODEX_WORKDIR`.
  - Missing prerequisite: any runtime validation done inside Docker must use a working repository that is actually visible inside the server container. For the e2e stack, Story `0000052` cannot assume arbitrary host repositories are readable unless the e2e environment is updated to mount them or the validation is performed through a non-e2e harness that already has filesystem access.
  - Validation implication:
    - the main Compose stack is sufficient for read-only access to a mounted working repository;
    - the local Compose stack is suitable when writable source mounts or Docker socket access are also needed;
    - the e2e Compose stack is not, by itself, proof that runtime `plan_scope` file reads work for arbitrary host repositories.

- **The story depends on existing env injection paths staying correct.**
  - Repo evidence:
    - startup env loading is centralized in `server/src/config/startupEnv.ts`;
    - checked-in defaults live in `server/.env`;
    - working-folder mapping uses `CODEINFO_HOST_INGEST_DIR` and `CODEINFO_CODEX_WORKDIR`.
  - Planning implication: tasking must include explicit validation that `working` and `plan_scope` continue to behave correctly when those env values are present, missing, or inconsistent with the mounted working repository path.

- **Validation wrappers already exist and should be treated as the default proof path.**
  - Repo evidence: root `package.json` already provides `build:summary:*`, `test:summary:*`, and `compose:*` wrappers, plus the compose launcher script `scripts/docker-compose-with-env.sh`.
  - Planning implication: final validation for Story `0000052` should be task-sized around those wrappers rather than inventing ad hoc raw commands, except where targeted diagnosis is required.
  - Concrete wrapper baseline to reference when tasking:
    - `npm run build:summary:server`
    - `npm run build:summary:client`
    - `npm run test:summary:server:unit`
    - `npm run compose:build:summary`
    - `npm run compose:up`
    - `npm run compose:down`
    - `npm run test:summary:e2e` only as optional regression smoke after deciding whether the e2e stack is actually an appropriate proof surface for the filesystem visibility required by the scenario being tested. It is not the primary proof path for this story's `plan_scope` filesystem behavior.

- **Docker image builds already copy application code into the image and build from there; this story must keep that model.**
  - Repo evidence:
    - `server/Dockerfile` copies repo files into build stages and runs the server build inside the image before creating the runtime image;
    - `client/Dockerfile` copies repo files into the build stage and runs the client build inside the image before creating the runtime image;
    - existing compose files do not bind-mount the application source tree into the main or e2e server/client containers.
  - Planning implication: Story `0000052` must not plan a host source-tree bind mount as the way to make application code or runtime changes visible inside containers. Runtime validation should rely on rebuilt images plus the existing working-repository bind mount for external repository data only.

- **If Docker-facing files are added or moved, the correct build-context ignore file must be updated deliberately.**
  - Repo evidence:
    - root `.dockerignore` trims the main build context;
    - `server/.dockerignore` and `client/.dockerignore` trim workspace-specific contexts.
  - Planning implication: if Story `0000052` adds any file that must be present during Docker image build, tasking must name the correct ignore file to review/update so the file is copied intentionally through the build context instead of being reached through a runtime bind mount.

- **No new Docker or compose port surface is required for this story; existing ports must be reused and treated as fixed.**
  - Repo evidence:
    - main stack: server `5010`, chat MCP `5011`, agents MCP `5012`, client `5001`, Chroma `8000`, Playwright MCP `8932`;
    - local stack: server `5510`, chat MCP `5511`, agents MCP `5512`, client `5501`, Chroma `8200`, Playwright MCP `8931`;
    - e2e stack: server `6010`, chat MCP `6011`, agents MCP `6012`, client `6001`, Chroma `8800`.
  - Planning implication: Story `0000052` should explicitly reuse those existing ports during validation and should not introduce new exposed ports for the feature.

- **Generated container artifacts should continue to prefer Docker-managed volumes, not source-tree bind mounts.**
  - Repo evidence:
    - current compose files already use named volumes for mutable runtime data such as `copilot-data`, `chroma-data`, `mongo_data`, `mongo_config`, and Playwright output;
    - the only recurring host bind mount intentionally used for persistence visibility is `./logs:/app/logs`.
  - Planning implication: if Story `0000052` needs any new generated artifact persistence during Docker validation, it should plan a Docker-managed volume for that output rather than a host source bind mount. Logs remain the one accepted host-visible bind-mounted artifact class.

- **Existing test harnesses do not yet cover the new target modes or handoff-file-driven scope resolution.**
  - Repo evidence:
    - current tests cover `sourceId`, `current`, and `all` in schema, runtime, and tool-result layers;
    - no current test harness proves reading `current-plan.json`, de-duplicating `additional_repositories`, or warning-style `plan_scope` completion.
  - Missing capability: Story `0000052` must add focused test support for:
    - runtime handoff-file fixtures under a working repository path;
    - `working` target resolution through existing working-folder plumbing;
    - `plan_scope` warning cases (malformed handoff, invalid additional repository, attempted repo failure);
    - lifecycle/tool-result behavior for `targetMode: "plan_scope"`.

## Additional Repositories

- No Additional Repositories

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

6. Report completed `plan_scope` batches with repository failures as success-with-warnings.
   - Question being addressed: When `plan_scope` continues past per-repository failures, should the overall re-ingest tool result still be marked as an error, or should it be treated as success-with-warnings?
   - Why the question matters: this decides whether a best-effort batch that completed its full repository pass looks like a hard failure in the UI and transcript, or like a completed run that needs attention.
   - What the answer is: treat a `plan_scope` batch as success-with-warnings when the batch starts successfully and completes its full ordered pass, even if some repositories in that batch fail. Keep the failed counts and warning details visible, but do not mark the whole batch as a hard error unless the batch itself cannot start.
   - Where the answer came from: direct user answer in this planning conversation, agreeing with the previously documented best answer.
   - Why it is the best answer: it matches the story's best-effort continuation rule, keeps the overall batch status aligned with the fact that the run completed, and still preserves visibility of failed repositories through counts, warning text, and logs.

## Implementation Ideas

- Implement this story in four ordered passes so the contract stays aligned across parser, runtime, and transcript layers:
  1. update the command and flow schemas/types to remove `current` and `all`, add `working` and `plan_scope`, and keep `sourceId`;
  2. update the execution layer so it can resolve a working repository and a plan-scope repository list;
  3. update the command/flow runners and persisted tool-result lifecycle so the new target modes are actually carried through every execution surface;
  4. update tests and checked-in workflow assets so the repository stops advertising removed target names.
- The schema-first file map is already narrow and should stay that way:
  - `server/src/agents/commandsSchema.ts`
  - `server/src/flows/flowSchema.ts`
    These files currently model re-ingest as `sourceId`, `target: "current"`, or `target: "all"`. The simplest change is to swap those target literals to `working` and `plan_scope` while keeping the strict object-shape approach already used throughout the repo. External Zod guidance favors `discriminatedUnion` when a single discriminator can cheaply pick the branch, but this story does not need a broad schema refactor unless it clearly reduces ambiguity in the existing strict-object union code.
- The runtime execution change should stay centered in `server/src/ingest/reingestExecution.ts`. That file already contains the three current execution branches, canonical selector handling, ordered batch execution, and the resolution log marker `DEV-0000050:T03:reingest_targets_resolved`. The implementation should keep `sourceId` behavior intact, replace the current-owner branch with a working-repository branch, and replace the all-repositories branch with a plan-scope branch that still reuses the existing batch execution loop and outcome normalization helpers.
- A small dedicated helper near the ingest execution layer is likely the cleanest seam for `plan_scope` resolution. A new helper such as `server/src/ingest/planScopeResolver.ts` should:
  - start from the working repository path already resolved for the run;
  - read `<working-repo>/codeInfoStatus/flow-state/current-plan.json`;
  - extract `additional_repositories[].path`;
  - normalize and de-duplicate in final execution order;
  - separate skipped-at-resolution warnings from attempted repository outcomes.
    The important design boundary is that malformed handoff data should degrade into warning metadata plus working-only execution, not a hard pre-start failure.
- Reuse existing repository-resolution seams instead of inventing a second lookup path. The working-folder plumbing in `server/src/workingFolders/state.ts`, `server/src/agents/service.ts`, and `server/src/flows/service.ts` already validates repository membership and maps host paths into the container-visible workdir. `plan_scope` should consume that existing working-repository result, then use the same selector/canonical-path logic already used by explicit `sourceId` re-ingest when turning additional repository paths into re-ingestable roots.
- The three execution surfaces must be updated together because they currently all log and forward the old target names:
  - direct commands through `server/src/agents/commandsRunner.ts`;
  - command items inside flows through `server/src/agents/commandItemExecutor.ts`;
  - dedicated flow re-ingest steps through `server/src/flows/service.ts`.
    The safest implementation order is to update the shared `executeReingestRequest` contract first, then rewire these callers so they pass the working-repository path instead of an owner path and preserve the new `targetMode` values in their existing logs.
- The user-facing result contract needs a matching update in `server/src/chat/reingestToolResult.ts` and `server/src/chat/reingestStepLifecycle.ts`. Today the batch payload and lifecycle parser only recognize `targetMode: "all"`, and the tool stage is forced to hard error when any batch repository fails. `plan_scope` should reuse the same batch payload shape, but with `targetMode: "plan_scope"` and warning-style completion semantics when the batch itself finishes its ordered pass. The lifecycle copy should also mention fallback and skip cases so persisted turns do not make a degraded plan-scope run look identical to a fully clean batch.
- Because `ChatToolResultEvent.stage` is currently limited to `success` or `error`, success-with-warnings should be represented by keeping `stage: "success"` and adding the explicit `warnings` array defined in `## Message Contracts and Storage Shapes` to the batch payload that gets persisted into `Turn.toolCalls`.
- MCP should stay explicitly out of scope in code, not just in prose. `server/src/mcp2/tools/reingestRepository.ts` still exposes a `sourceId`-only contract today, and the implementation should leave that surface unchanged. This story should not add `working` or `plan_scope` parsing, fallback, or handoff-file reads to MCP.
- Checked-in workflow assets should be handled as a verify-then-update step rather than assumed churn. Current repo searches show the removed target literals are concentrated in runtime and tests rather than checked-in command/flow JSON assets. The story should still keep a final verification search for checked-in asset literals so implementation can either update any real asset that exists or record that no repository-owned command/flow files needed migration.
- The most likely tests to update are already well signposted by the existing old-target assertions:
  - `server/src/test/unit/agent-commands-schema.test.ts`
  - `server/src/test/unit/flows-schema.test.ts`
  - `server/src/test/unit/reingestExecution.test.ts`
  - `server/src/test/unit/agent-commands-runner.test.ts`
  - `server/src/test/unit/reingest-tool-result.test.ts`
  - `server/src/test/unit/reingest-step-lifecycle.test.ts`
  - `server/src/test/integration/commands.reingest.test.ts`
  - `server/src/test/integration/flows.run.command.test.ts`
    These tests should prove both contract replacement and behavior reuse: `working` should behave like the old single-repository path except that it targets the selected working repository, while `plan_scope` should reuse the old batch continuation mechanics without inheriting `all`'s canonical-path ordering semantics.
- The highest-risk implementation mistake is to update schema acceptance without updating transcript and lifecycle readers. A partial change would let commands or flows parse `working` / `plan_scope` but then either persist them as the wrong target mode or reject them when the tool result is recorded. The second highest-risk mistake is to treat skipped-at-resolution repositories as synthetic attempted repositories, which would quietly change the meaning of the reused batch payload and summary counts.
- Validation should continue to follow the existing wrapper-first and Docker rules already documented elsewhere in this plan:
  - build and test through the existing summary wrappers before doing any compose proof;
  - keep application code copied into the image build, not bind-mounted from the host;
  - only rely on compose scenarios where the working repository is visible through the existing `${CODEINFO_HOST_INGEST_DIR}` to `${CODEINFO_CODEX_WORKDIR}` mapping;
  - reuse the existing compose port surfaces rather than adding new ones for this feature.

## Test Harnesses

- This story does not require a new top-level test runner, a new HTTP test surface, or a new Docker/e2e harness. The existing server unit and integration suites already cover the relevant execution layers, and the current wrappers in `package.json` are sufficient for final validation.
- This story does require one new reusable filesystem fixture helper because `plan_scope` introduces a test shape the current suites do not yet support cleanly: reading `<working-repo>/codeInfoStatus/flow-state/current-plan.json` and turning that file into ordered repository scope plus warnings.
- Create that helper in `server/src/test/support/planScopeFixture.ts` so both unit and integration suites can share it instead of duplicating ad hoc `fs.mkdir`, `fs.writeFile`, and cleanup logic inside individual test files.
- The helper should use the same lightweight Node.js filesystem-fixture pattern already used elsewhere in this repository's tests and consistent with current `node:test` guidance:
  - create temp roots with `fs.mkdtemp`;
  - create only the directories needed for the scenario;
  - write the handoff file with `fs.writeFile`;
  - remove the temp tree with `fs.rm(..., { recursive: true, force: true })` during teardown.
  - do not plan around `fsPromises.mkdtempDisposable()` or `await using`; the current repository baseline is Node 22 and the checked-in tests already standardize on `fs.mkdtemp` plus explicit cleanup.
- The helper should be able to build the exact plan-scope scenarios this story needs:
  - working-repository-only fixture with no handoff file;
  - handoff file present with empty `additional_repositories`;
  - valid ordered additional repository entries;
  - duplicate entries, including a duplicate of the working repository;
  - malformed JSON payloads;
  - entries that point at paths the ingest lookup will treat as invalid or not currently ingested.
- The helper needs its own direct smoke test in `server/src/test/unit/planScopeFixture.test.ts` so the story proves the harness can create and tear down the temporary repository layouts it is responsible for without uncaught filesystem errors.
- The first consumers of this helper should be:
  - `server/src/test/unit/planScopeFixture.test.ts`, to prove the helper itself can execute, create the expected handoff layout, and clean up without leaking temp directories;
  - `server/src/test/unit/reingestExecution.test.ts`, to prove scope resolution, de-duplication, missing-file fallback, malformed-file fallback, and skipped-at-resolution behavior without starting the HTTP server;
  - `server/src/test/integration/commands.reingest.test.ts`, to prove direct-command `working` and `plan_scope` execution against a realistic temporary repo layout;
  - `server/src/test/integration/flows.run.command.test.ts`, to prove both top-level flow re-ingest steps and flow-owned command re-ingest items use the same handoff-file semantics.
- Warning-style result coverage should extend the existing local harnesses rather than creating a second shared support layer. In particular:
  - keep using the inline batch builders in `server/src/test/unit/reingest-tool-result.test.ts`;
  - keep extending the existing `buildHarness()` flow in `server/src/test/unit/reingest-step-lifecycle.test.ts`.
    Those tests already capture tool payloads, persisted turns, and log arrays, so they can absorb `targetMode: "plan_scope"` and success-with-warnings assertions without a brand-new runner helper.
- Do not create a new Playwright or compose-only harness for this story. Current repo evidence shows the missing capability is handoff-file-backed fixture setup inside server tests, not a missing browser or container test type.

## Proof Path Readiness

- **Server build proof is already runnable.**
  - `npm run build:summary:server` already exists and can run as soon as the code compiles.
  - No story-specific harness or runtime prerequisite must be created before this proof step.

- **Client build proof is already runnable, but it is repository-regression proof rather than direct feature proof.**
  - `npm run build:summary:client` already exists.
  - This story does not add a new frontend surface, so the client build should stay in the proof path as a regression gate, not as the main proof that `working` or `plan_scope` behaves correctly.

- **Feature-specific server test proof becomes runnable only after the new fixture helper and tests exist.**
  - `npm run test:summary:server:unit` already exists, and the wrapper already supports targeted diagnosis through `--file` and `--test-name`.
  - The missing prerequisite is the shared `server/src/test/support/planScopeFixture.ts` helper plus the new or updated tests that consume it.
  - The realistic proof order is:
    1. create the shared plan-scope fixture helper;
    2. add or update the targeted unit and integration tests;
    3. use targeted wrapper runs for diagnosis;
    4. finish with the full `npm run test:summary:server:unit` wrapper.

- **Compose proof is runnable, but only on stacks that can actually see the working repository handoff file.**
  - `npm run compose:build:summary`, `npm run compose:up`, `npm run compose:down`, and `npm run compose:logs` already exist.
  - The main and local compose stacks are realistic proof surfaces because they mount `${CODEINFO_HOST_INGEST_DIR}` into `${CODEINFO_CODEX_WORKDIR}`.
  - The proof path should therefore use main or local compose when validating runtime `plan_scope` file reads inside the server container.

- **E2E proof is not a required feature-proof step for this story as currently scoped.**
  - `npm run test:summary:e2e` is runnable as a repository-level regression wrapper, but it does not currently prove `plan_scope` handoff-file behavior because the e2e compose stack does not mount the host ingest root into the server container.
  - The story should not rely on e2e as evidence that `working` / `plan_scope` runtime resolution works.
  - If a future story wants browser-level proof of this exact filesystem behavior, that work must first add the missing runtime visibility and a UI-drivable scenario.

- **No new wrapper script is required for this story.**
  - Existing wrapper scripts already cover build, targeted server diagnosis, full server validation, compose build/up/down, and optional e2e regression runs.
  - The realistic prerequisite work is harness and test creation, not wrapper-script creation.

## Feasibility Proof

### 1. Schema parsing

- Already existing capabilities:
  - `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts` already model re-ingest as a strict object union with `sourceId` and literal `target` branches.
  - Existing unit tests in `server/src/test/unit/agent-commands-schema.test.ts` and `server/src/test/unit/flows-schema.test.ts` already prove acceptance and rejection for the current target literals.
- Missing prerequisite capabilities:
  - The schemas and their dependent tests must be updated to replace `target: "current"` and `target: "all"` with `target: "working"` and `target: "plan_scope"`.
  - Any schema-driven metadata/log assertions that still assume the old target names must be updated at the same time.
- Assumptions that are currently invalid:
  - It is not valid to assume the parser already accepts `working` or `plan_scope`.
  - It is not valid to assume `current` can stay as a compatibility alias; the story removes it from the supported contract entirely.

### 2. Working-folder and repository resolution

- Already existing capabilities:
  - `server/src/workingFolders/state.ts` already normalizes, validates, and maps `working_folder` paths into the container-visible workdir.
  - `server/src/agents/service.ts`, `server/src/flows/service.ts`, and the working-folder integration coverage in `server/src/test/integration/flows.run.working-folder.test.ts` already prove that runs can start with a validated working repository path.
- Missing prerequisite capabilities:
  - The re-ingest execution path must be taught to consume the already-resolved working repository as its first-class input for `target: "working"` and `target: "plan_scope"`.
  - That same resolved working repository must then be passed consistently from direct commands, top-level flow re-ingest steps, and flow-owned command items.
- Assumptions that are currently invalid:
  - It is not valid to assume every run has a usable working repository today.
  - It is not valid to assume a validated `working_folder` automatically means the repository is currently ingested; the story still needs an explicit not-ingested failure path for `working`.

### 3. `plan_scope` handoff-file resolution

- Already existing capabilities:
  - The product already uses `codeInfoStatus/flow-state/current-plan.json` as a checked-in handoff artifact, and the story’s plan host already carries that file today.
  - The repo already has canonical path normalization and repository-selector helpers that can be reused once extra repository paths are read.
- Missing prerequisite capabilities:
  - There is no runtime helper yet that reads `<working-repo>/codeInfoStatus/flow-state/current-plan.json` during re-ingest.
  - A dedicated resolver such as `server/src/ingest/planScopeResolver.ts` must be created to read `additional_repositories[].path`, preserve file order, remove duplicates, and convert malformed or unusable entries into warnings instead of hard failures.
- Assumptions that are currently invalid:
  - It is not valid to assume the current re-ingest runtime already knows how to read `current-plan.json`.
  - It is not valid to assume skipped-at-resolution repositories can be represented as if they were attempted repositories; that would change the existing batch payload contract.

### 4. Re-ingest execution and batch continuation

- Already existing capabilities:
  - `server/src/ingest/reingestExecution.ts` already supports a single-repository path (`sourceId` and `current`) and a batch path (`all`).
  - The batch execution loop already continues after repository-level failures and already records per-repository outcomes in order.
- Missing prerequisite capabilities:
  - The single-repository branch must be adapted from owner-based `current` to working-repository `working`.
  - The batch branch must be adapted from global-ingested-repository `all` to handoff-driven `plan_scope`, including working-repo-first ordering and resolution-time warning handling.
- Assumptions that are currently invalid:
  - It is not valid to assume `plan_scope` can simply reuse `all` unchanged; `all` currently sorts every ingested repository by canonical path, which is not the required plan-scope ordering.
  - It is not valid to assume malformed handoff data should abort the batch before the working repository runs.

### 5. Tool-result and lifecycle persistence

- Already existing capabilities:
  - `server/src/chat/reingestToolResult.ts` already builds a structured single-result payload and a structured batch payload.
  - `server/src/chat/reingestStepLifecycle.ts` already persists and publishes re-ingest tool results into the conversation lifecycle.
- Missing prerequisite capabilities:
  - Both files must be extended to recognize `targetMode: "working"` and `targetMode: "plan_scope"`.
  - The batch tool-result stage and lifecycle text must gain an explicit success-with-warnings path for completed `plan_scope` runs that contain warnings or failed repositories.
- Assumptions that are currently invalid:
  - It is not valid to assume the current lifecycle already supports warning-style batch completion.
  - It is not valid to assume a partially failed batch will persist as a non-error result today; the current tool-result layer still maps any failed batch repository to hard error.

### 6. Test harness support

- Already existing capabilities:
  - The repo already has unit coverage for schemas, execution, tool-result shaping, and lifecycle persistence.
  - The repo already has integration harnesses for direct commands and flows that build temporary repository layouts and exercise real server entry points.
- Missing prerequisite capabilities:
  - The shared filesystem-backed plan-scope fixture helper documented in `## Test Harnesses` must be created so tests can write and vary `current-plan.json` payloads without duplicating setup code.
  - Existing unit and integration suites must then add the missing scenarios for missing handoff files, malformed handoff files, duplicate repositories, invalid additional repositories, and warning-style completion.
- Assumptions that are currently invalid:
  - It is not valid to assume current test fixtures already prove `plan_scope` file reading, de-duplication, or warning propagation.
  - It is not valid to assume this story needs a brand-new Playwright or compose-only harness; the missing capability is fixture setup inside the server test suites.

### 7. Docker and compose validation surfaces

- Already existing capabilities:
  - The root wrappers in `package.json` already provide the build, test, and compose validation entry points the story should use.
  - The main and local compose stacks already mount `${CODEINFO_HOST_INGEST_DIR}` into `${CODEINFO_CODEX_WORKDIR}`, which is the required visibility seam for filesystem-backed working-repository validation.
- Missing prerequisite capabilities:
  - Any compose-based proof for `plan_scope` must first ensure the chosen working repository lives under the mounted ingest root that the server container can actually read.
  - If future Docker-facing files are added as part of this story, the relevant `.dockerignore` file must be updated so those files reach the image build context intentionally.
- Assumptions that are currently invalid:
  - It is not valid to assume the e2e compose stack can prove arbitrary host-repository `plan_scope` reads; that stack does not mount the host ingest root into the server container.
  - It is not valid to assume host source bind mounts should be used for application code; this repository’s Docker model still expects code to be copied into images and built there.

## Task Feasibility Proof

- Repository scope check:
  - This story remains single-repository work in `Current Repository`.
  - No cross-repository task split is required because the active handoff and the plan's `Additional Repositories` section both identify no extra repositories.

### Task 1. Replace The Authored Re-Ingest Contract

- Already existing capabilities:
  - `server/src/agents/commandsSchema.ts` and `server/src/flows/flowSchema.ts` already define the schema unions that must be updated in place.
  - `server/src/test/unit/agent-commands-schema.test.ts` and `server/src/test/unit/flows-schema.test.ts` already provide the parser proof surface this task needs.
- Missing prerequisite capabilities:
  - No new prerequisite capability is required before Task 1 starts.
- Assumptions that are currently invalid:
  - It is not valid to assume checked-in command or flow JSON assets still use `target: "current"` or `target: "all"`. This task must verify by search first and only edit real assets if they exist.

### Task 2. Add The Shared Plan-Scope Fixture Harness

- Already existing capabilities:
  - `server/src/test/unit/pathMap.test.ts` and the temporary-directory patterns in `server/src/test/unit/agent-commands-runner.test.ts` already show the fixture style this task should reuse.
- Missing prerequisite capabilities:
  - `server/src/test/support/planScopeFixture.ts` and `server/src/test/unit/planScopeFixture.test.ts` do not exist yet and must be created here before later resolver and execution tasks can depend on them.
- Assumptions that are currently invalid:
  - It is not valid to assume this task should also own repository selection or warning shaping. The fixture harness should stay on temp-repository creation and cleanup only.

### Task 3. Add The Plan-Scope Resolution Helper

- Already existing capabilities:
  - `server/src/mcpCommon/repositorySelector.ts`, `server/src/ingest/pathMap.ts`, and `server/src/workingFolders/state.ts` already provide the selector, normalization, and path-mapping seams this task should wrap rather than duplicate.
  - The new fixture harness from Task 2 provides the test setup this resolver task should reuse.
- Missing prerequisite capabilities:
  - `server/src/ingest/planScopeResolver.ts` and `server/src/test/unit/planScopeResolver.test.ts` do not exist yet and must be created here before execution work can depend on them.
- Assumptions that are currently invalid:
  - It is not valid to assume `current-plan.json` always exists or is readable. Task 3 must implement and prove missing-file, malformed-file, and warning-only fallback behavior at the helper boundary itself.

### Task 4. Implement Working And Plan-Scope Execution

- Already existing capabilities:
  - `server/src/ingest/reingestExecution.ts` already owns the shared execution seam and already exposes the logging and outcome-normalization hooks that should be updated in place.
  - `server/src/test/unit/reingestExecution.test.ts` already provides the unit proof surface for execution behavior.
  - `server/src/test/unit/mcp.reingest.classic.test.ts` and `server/src/test/unit/mcp2.reingest.tool.test.ts` already provide the sourceId-only MCP proof surfaces this story should preserve.
- Missing prerequisite capabilities:
  - Task 3's resolver and Task 2's fixture support must exist first so Task 4 can consume them instead of rebuilding plan-scope resolution inline.
- Assumptions that are currently invalid:
  - It is not valid to assume every run has a usable working repository. Task 4 must treat missing or unresolved `working_folder` context as a clear pre-start failure for `working`.
  - It is not valid to assume the current execution seam already accepts working-repository context. Task 4 must add that explicit input before Tasks 6 and 7 can wire direct-command and flow callers to it.

### Task 5. Implement The Re-Ingest Message And Persistence Contract

- Already existing capabilities:
  - `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, and `server/src/mongo/turn.ts` already own the tool-result payload, synthetic-turn lifecycle, and persistence slot that this task should extend.
  - `server/src/test/unit/reingest-tool-result.test.ts` and `server/src/test/unit/reingest-step-lifecycle.test.ts` already cover the current payload and persistence behavior.
- Missing prerequisite capabilities:
  - Task 4's updated execution payloads must exist first so Task 5 can persist the new `working` / `plan_scope` result shapes and warnings array.
- Assumptions that are currently invalid:
  - It is not valid to assume a new tool stage enum can be introduced here. The existing contract remains `success | error`, so warning-style completion must stay inside the payload.

### Task 6. Wire Direct Commands To The New Runtime Contract

- Already existing capabilities:
  - `server/src/agents/commandsRunner.ts` and the direct-command test suites already provide the command surface this task needs to update in place.
- Missing prerequisite capabilities:
  - Task 4 must land the new execution behavior and Task 5 must land the new persisted payload contract before Task 6 can wire the direct-command surface to them.
  - The repository does not yet have a checked-in re-ingest command asset that Task 8 can invoke on the compose stack, so Task 6 must create one if no suitable command already exists.
- Assumptions that are currently invalid:
  - It is not valid to assume direct-command tests already assert the new target-mode values or warning behavior. Task 6 must update those expectations explicitly.

### Task 7. Wire Flow Re-Ingest Surfaces To The New Runtime Contract

- Already existing capabilities:
  - `server/src/agents/commandItemExecutor.ts`, `server/src/flows/service.ts`, and the flow integration suites already provide the flow surfaces this task needs to update in place.
- Missing prerequisite capabilities:
  - Tasks 4 and 5 must complete first so Task 7 can wire top-level flow steps and flow-owned command items to the new execution and payload contracts.
- Assumptions that are currently invalid:
  - It is not valid to assume `server/src/agents/commandItemExecutor.ts` directly calls `executeReingestRequest`. Task 7 must keep execution ownership in `server/src/flows/service.ts` and use `commandItemExecutor.ts` only for the command-item delegation/logging boundary it already owns.
  - It is not valid to assume existing flow tests already assert the new pre-start wording, warning payloads, transcript text, or target-mode values. Task 7 must update those expectations explicitly.

### Task 8. Validate Working-Folder Environment And Mounted Runtime Access

- Already existing capabilities:
  - `server/src/ingest/pathMap.ts`, `server/src/routes/ingestDirs.ts`, `server/src/workingFolders/state.ts`, `server/src/test/unit/pathMap.test.ts`, and the checked-in compose files already define the environment and mount semantics that this task should validate.
- Missing prerequisite capabilities:
  - Tasks 4 through 7 must complete first so Task 8 can validate the actual new `working` / `plan_scope` runtime behavior rather than the removed `current` / `all` contract.
- Assumptions that are currently invalid:
  - It is not valid to assume the e2e compose stack is the correct filesystem proof surface. Task 8 must use the main or local compose surface that actually exposes the working repository to the server container.

### Task 9. Final Validation And Story Close-Out

- Already existing capabilities:
  - `README.md`, `design.md`, `docs/developer-reference.md`, and `projectStructure.md` already exist and are the correct docs to update in place.
  - The repository already provides the build, test, and compose wrappers needed for close-out.
- Missing prerequisite capabilities:
  - Tasks 1 through 8 must be complete first so Task 9 can validate the finished contract rather than partial behavior.
- Assumptions that are currently invalid:
  - No cross-repository close-out work is required for this story because the validated scope stays inside the current repository only.
  - It is not valid to assume a Material UI or other client-side re-ingest consumer exists today; current repository evidence shows this story remains server-and-documentation work unless implementation later adds a new UI surface deliberately.

## Edge Cases and Failure Modes

- **Authored JSON provides both `sourceId` and `target`, or includes unexpected extra keys.**
  - Current command and flow schemas use strict object branches, so mixed or extra-key shapes should fail parsing rather than being partially accepted.
  - The story should preserve that behavior when `working` and `plan_scope` replace `current` and `all`.

- **`working_folder` is missing, points to a non-directory, falls outside the known repository set, or belongs to a repository that is not currently ingested.**
  - `working` must fail before starting re-ingest.
  - `plan_scope` must also fail before starting if the working repository itself cannot be resolved as the first attempted repository.

- **The working repository path is valid but cannot be mapped into the container-visible workdir because host/container path configuration is inconsistent.**
  - This should be treated as an operational pre-start failure, not as a silent fallback to some other repository.
  - Validation should make it obvious whether the failure came from `CODEINFO_HOST_INGEST_DIR`, `CODEINFO_CODEX_WORKDIR`, or a path outside the mounted ingest root.

- **`current-plan.json` is absent, unreadable because of permissions, empty, or contains malformed JSON.**
  - Missing or unreadable handoff data should not abort a batch that otherwise has a usable working repository.
  - `plan_scope` should continue with the working repository only and record a warning that explains why extra repositories were not attempted.

- **`current-plan.json.additional_repositories` exists but contains invalid entries.**
  - Examples that must be treated as skipped-at-resolution warnings:
    - missing `path`
    - non-string `path`
    - blank or whitespace-only `path`
    - a path that normalizes to the working repository again
    - a path that normalizes to a duplicate of another additional repository
    - a path that does not resolve to a currently ingested repository
  - These entries must not be inserted into the attempted `repositories` array.

- **The same repository is referred to by different but equivalent selector forms.**
  - Host path, container path, casing differences in repository ids, and trailing-slash differences should all normalize through the existing repository selector path before de-duplication.
  - The first resolved occurrence should win, and later equivalent occurrences should become warnings rather than second attempts.

- **The repository selector resolves multiple candidates for the same id or path because more than one ingest record exists.**
  - `plan_scope` should reuse the same latest-ingest selection rules already used by explicit `sourceId` resolution.
  - The story should not add a second repository-selection algorithm just for handoff-file entries.

- **`plan_scope` starts successfully but one attempted repository later returns `skipped`, `cancelled`, structured error, or unexpected error.**
  - The batch must continue through later repositories in final order.
  - The batch `summary` must count only attempted repositories.
  - Repository-level failures must also appear in the batch `warnings` array so the completed run is visibly degraded even when tool-result `stage` remains `success`.

- **A completed `plan_scope` batch contains warnings but no failed attempted repositories.**
  - The completed result should still publish and persist as `stage: "success"` with populated `warnings`.
  - The implementation should not invent a third tool-result stage or collapse warnings into silent logs only.

- **A `plan_scope` request resolves only the working repository because no usable additional repositories remain.**
  - This is a normal degraded-path success case when the working repository is valid and the handoff is missing, unreadable, malformed, empty, or contains only skipped additional entries.
  - The story should prove the batch still attempts the working repository, records warning data for the degraded scope, and does not invent a separate empty-batch success path.

- **Historical persisted re-ingest payloads still contain `targetMode: "current"` or `targetMode: "all"`.**
  - New writes from this story should use only `working` and `plan_scope`.
  - Existing stored payloads should remain readable through lifecycle normalization so old transcripts do not break when the new code is deployed.

- **Docker validation is attempted in an environment where the server container cannot see the working repository handoff file.**
  - That environment can incorrectly look like a missing handoff-file fallback when the real problem is missing volume visibility.
  - Validation notes and tests should distinguish true missing-handoff behavior from container-mount misconfiguration so the feature is not falsely marked as working.

## Questions

# Tasks

### Task 1. Replace The Authored Re-Ingest Contract

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `e11d1f16`

#### Overview

Replace the command and flow authoring contract so newly-authored re-ingest items use `sourceId`, `working`, or `plan_scope`, and the removed `current` / `all` literals fail schema validation. This task is only about parser- and type-level contract replacement, so it can be proved with focused schema tests before runtime execution changes are attempted.

#### Documentation Locations

- `https://zod.dev/api?id=unions` - use for the standard union parsing rules that matter when the schema accepts one of several authored re-ingest shapes.
- `https://zod.dev/api?id=discriminated-unions` - use for discriminator-based unions and literal branches; this is relevant if the final schema shape is expressed with a clearer discriminator key instead of a broad union.
- `https://zod.dev/api?id=objects` - use for `z.strictObject()` and unknown-key rejection, which is directly relevant to the tests that must reject extra keys.

#### Subtasks

1. [x] Current Repository: In `server/src/agents/commandsSchema.ts`, replace the re-ingest command union so the only authored shapes are `{ "type": "reingest", "sourceId": "<selector>" }`, `{ "type": "reingest", "target": "working" }`, and `{ "type": "reingest", "target": "plan_scope" }`. Read/update: `server/src/agents/commandsSchema.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, Context7 `/colinhacks/zod`. Remove every `current` / `all` literal branch from both the schema and the inferred command item types. Documentation: https://zod.dev/api?id=unions ; https://zod.dev/api?id=discriminated-unions ; https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
2. [x] Current Repository: In `server/src/flows/flowSchema.ts`, make the same authored-contract replacement for top-level flow re-ingest steps so the only accepted shapes are `{ sourceId }`, `target: "working"`, or `target: "plan_scope"`. Read/update: `server/src/flows/flowSchema.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, Context7 `/colinhacks/zod`. Remove every `current` / `all` literal branch from both the schema and the exported flow-step types. Documentation: https://zod.dev/api?id=unions ; https://zod.dev/api?id=discriminated-unions ; https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
3. [x] Current Repository: Unit test update: `server/src/test/unit/agent-commands-schema.test.ts`. Purpose: prove command JSON accepts the happy-path authored shapes `{ sourceId }`, `target: "working"`, and `target: "plan_scope"` after the schema change. Read/update: `server/src/test/unit/agent-commands-schema.test.ts`, `server/src/agents/commandsSchema.ts`. Documentation: https://zod.dev/api?id=unions ; https://zod.dev/api?id=discriminated-unions ; https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
4. [x] Current Repository: Unit test update: `server/src/test/unit/agent-commands-schema.test.ts`. Purpose: prove command JSON rejects removed literals `current` / `all`, mixed `{ sourceId, target }`, and unexpected extra keys so the error-path contract is explicit. Read/update: `server/src/test/unit/agent-commands-schema.test.ts`, `server/src/agents/commandsSchema.ts`. Documentation: https://zod.dev/api?id=unions ; https://zod.dev/api?id=discriminated-unions ; https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
5. [x] Current Repository: Unit test update: `server/src/test/unit/flows-schema.test.ts`. Purpose: prove flow JSON accepts the happy-path authored shapes `{ sourceId }`, `target: "working"`, and `target: "plan_scope"` after the schema change. Read/update: `server/src/test/unit/flows-schema.test.ts`, `server/src/flows/flowSchema.ts`. Documentation: https://zod.dev/api?id=unions ; https://zod.dev/api?id=discriminated-unions ; https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
6. [x] Current Repository: Unit test update: `server/src/test/unit/flows-schema.test.ts`. Purpose: prove flow JSON rejects removed literals `current` / `all`, mixed `{ sourceId, target }`, and unexpected extra keys so the error-path contract is explicit. Read/update: `server/src/test/unit/flows-schema.test.ts`, `server/src/flows/flowSchema.ts`. Documentation: https://zod.dev/api?id=unions ; https://zod.dev/api?id=discriminated-unions ; https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
7. [x] Current Repository: Search checked-in command and flow JSON assets for removed literals with a repository-wide search such as `rg '\"target\": \"(current|all)\"'`. If real assets exist, update them to the correct new literal in the owning file; if none exist, record that result in this task's Implementation notes so the acceptance criterion is still explicitly closed out. Read/update: repository root plus any matching JSON command/flow files, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://zod.dev/api?id=unions ; https://zod.dev/api?id=discriminated-unions ; https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
8. [x] Current Repository: Update this story file if the concrete schema implementation in `server/src/agents/commandsSchema.ts` or `server/src/flows/flowSchema.ts` reveals any authored-contract detail that differs from the planned shapes above, so later developers do not have to infer the final contract from code alone. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, `planning/plan_format.md`. Documentation: https://zod.dev/api?id=unions ; https://zod.dev/api?id=discriminated-unions ; https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
9. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T1:reingest-target-contract` in the command or flow validation path touched by this task. Expected Manual Playwright-MCP logs-page outcome: the marker appears for one accepted `working` or `plan_scope` validation and for one rejected removed-target validation, so the logs confirm the authored target contract changed as expected. Read/update: `server/src/agents/commandsSchema.ts`, `server/src/flows/flowSchema.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://zod.dev/api?id=objects ; Context7 /colinhacks/zod.
10. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
11. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 1 only changes server-authored schema contracts. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper instead of raw `node:test` commands because Task 1 changes server schema parsing. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper instead of raw Cucumber commands because schema changes can affect authored command and flow behavior. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Replaced the command re-ingest schema branches with `sourceId`, `working`, and `plan_scope`, and removed the old `current` / `all` literal types from the inferred command contract.
- Replaced the flow re-ingest schema branches with `sourceId`, `working`, and `plan_scope`, and removed the old `current` / `all` literal types from the exported flow-step contract.
- Updated the command schema unit tests to accept `working` / `plan_scope`, reject removed targets, and keep mixed-shape and extra-key rejection explicit.
- Updated the flow schema unit tests to accept `working` / `plan_scope`, reject removed targets, and keep mixed-shape and extra-key rejection explicit.
- Searched the repository for checked-in command or flow JSON assets using removed targets; no owned command/flow JSON assets required migration for this task.
- The final schema shape matched the planned authored contract, so no additional Task 1 contract wording change was needed in this story file.
- Added `DEV-0000052:T1:reingest-target-contract` logging on accepted supported targets and rejected removed targets when schema parse logging is enabled.
- `npm run lint` initially failed on pre-existing repository import-order warnings; `npm run lint:fix` cleared most of them and one remaining warning in `server/src/index.ts` was fixed manually before rerunning `npm run lint`.
- `npm run format:check` initially failed on repository-wide Prettier drift, so `npm run format` was run before rerunning `npm run format:check` successfully.
- `npm run build:summary:server` initially failed on downstream type seams that still only accepted `current` / `all`; the shared request and tool-result type unions were widened so the schema contract compiles cleanly ahead of the later runtime-contract task, and the wrapper then passed with `agent_action: skip_log`.
- `npm run test:summary:server:unit` initially failed on old `current` / `all` authoring tests and one stale batch-log assertion; the affected unit and integration test fixtures were updated to `working` / `plan_scope`, one targeted wrapper rerun for `server/src/test/unit/agent-commands-runner.test.ts` passed, and the final full wrapper passed with `1467` tests run and `0` failed.
- Final validation after the follow-up edits passed with `npm run lint`, `npm run format:check`, `npm run build:summary:server`, `npm run test:summary:server:unit`, and `npm run test:summary:server:cucumber`; the cucumber wrapper finished with `75` tests run and `0` failed.

---

### Task 2. Add The Shared Plan-Scope Fixture Harness

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `e11d1f16, 2a088f5b`

#### Overview

Create the shared filesystem fixture helper that later plan-scope tasks will depend on. This task should stay focused on reusable temp-repository setup and cleanup so the resolver and execution tasks can consume a stable harness instead of hand-rolling their own file trees.

#### Documentation Locations

- Context7 `/nodejs/node/v22.17.0` - use for the Node 22 `fs.mkdtemp` temp-directory API, the trailing-separator requirement for safe temp-dir creation, `fs.rm(..., { recursive: true, force: true })` cleanup, and `node:test` patterns used by the fixture smoke test.

#### Subtasks

1. [x] Current Repository: Create `server/src/test/support/planScopeFixture.ts` as the shared helper for plan-scope filesystem scenarios. The helper must be able to create: a working repository root, `<working-repo>/codeInfoStatus/flow-state/current-plan.json`, ordered `additional_repositories[].path` entries, duplicate entries, malformed JSON content, invalid repository-path cases, and an unreadable-handoff scenario or equivalent deterministic read-failure setup that later tests can use. Read/update: `server/src/test/support/planScopeFixture.ts`, `codeInfoStatus/flow-state/current-plan.json`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: Context7 /nodejs/node/v22.17.0.
2. [x] Current Repository: Keep `server/src/test/support/planScopeFixture.ts` limited to fixture setup and teardown only. Do not add repository selection, warning construction, or re-ingest execution logic here; later tasks must still own that work in `server/src/ingest/planScopeResolver.ts` and `server/src/ingest/reingestExecution.ts`. Read/update: `server/src/test/support/planScopeFixture.ts`, `server/src/ingest/planScopeResolver.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
3. [x] Current Repository: Copy the repository's existing temp-directory style instead of inventing a new harness pattern: follow `server/src/test/unit/agent-commands-runner.test.ts` and `server/src/test/unit/pathMap.test.ts`, using `fs.mkdtemp`, only the minimum directories needed for the scenario, and teardown with `fs.rm(..., { recursive: true, force: true })`. Read/update: `server/src/test/unit/agent-commands-runner.test.ts`, `server/src/test/unit/pathMap.test.ts`, `server/src/test/support/planScopeFixture.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
4. [x] Current Repository: Unit test addition: `server/src/test/unit/planScopeFixture.test.ts`. Purpose: prove the fixture helper can create the happy-path working-repository layout and write the expected `current-plan.json` variants for later resolver and execution tests. Read/update: `server/src/test/unit/planScopeFixture.test.ts`, `server/src/test/support/planScopeFixture.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
5. [x] Current Repository: Unit test addition: `server/src/test/unit/planScopeFixture.test.ts`. Purpose: prove the fixture helper supports the unreadable/read-failure scenario and still cleans up temp directories without uncaught filesystem errors. Read/update: `server/src/test/unit/planScopeFixture.test.ts`, `server/src/test/support/planScopeFixture.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
6. [x] Current Repository: Markdown update: `projectStructure.md`. Purpose: document the new files created by this task, including `server/src/test/support/planScopeFixture.ts` and `server/src/test/unit/planScopeFixture.test.ts`, after those files exist and before the task is marked complete. Read/update: `projectStructure.md`, `server/src/test/support/planScopeFixture.ts`, `server/src/test/unit/planScopeFixture.test.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
7. [x] Current Repository: Update this story file if the final helper boundary in `server/src/test/support/planScopeFixture.ts` turns out to be narrower or clearer than the current task text, so later tasks inherit the exact supported harness shape. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, `server/src/test/support/planScopeFixture.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
8. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T2:plan-scope-fixture-proof` to the fixture-owned proof path for this task. Expected Manual Playwright-MCP logs-page outcome: after the final server-unit proof finishes, the logs include this marker with `outcome: "fixture_backed_proof_passed"`, confirming the shared fixture harness supported the finished story proof. Read/update: `server/src/test/support/planScopeFixture.ts`, `server/src/test/unit/planScopeFixture.test.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: Context7 /nodejs/node/v22.17.0.
9. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
10. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 2 adds server-side test harness files. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper instead of raw `node:test` commands because Task 2 adds unit-tested server harness support. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Added `server/src/test/support/planScopeFixture.ts` as a setup-and-cleanup-only helper that creates working-repository roots, `current-plan.json` variants, duplicate path inputs, invalid repository paths, malformed JSON, and a deterministic read-failure setup.
- Kept the fixture boundary narrow by avoiding repository-selection, warning-shaping, or re-ingest execution behavior; later resolver and execution tasks still own that logic.
- Matched the repository's existing temp-directory style with `fs.mkdtemp` and `fs.rm(..., { recursive: true, force: true })` instead of introducing a new fixture pattern.
- Added `server/src/test/unit/planScopeFixture.test.ts` to prove happy-path layout creation, handoff variants, deterministic read failure, cleanup, and the Task 2 proof marker.
- Updated `projectStructure.md` for the two new Task 2 files.
- The implemented helper boundary matched the planned Task 2 shape, so no additional task-wording change was needed in this story file.
- Added `DEV-0000052:T2:plan-scope-fixture-proof` from the smoke-test proof path with `outcome: "fixture_backed_proof_passed"`.
- `npm run lint` passed for the Task 2 changes without needing follow-up fixes.
- `npm run format:check` failed on the new fixture files, so `npm run format` was run and `npm run format:check` then passed cleanly.
- `npm run build:summary:server` finished with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- `npm run test:summary:server:unit` finished with `tests run: 1469`, `failed: 0`, and `agent_action: skip_log`, confirming the shared fixture harness integrates cleanly with the full server unit suite.

---

### Task 3. Add The Plan-Scope Resolution Helper

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `01f1e861`

#### Overview

Create the plan-scope resolution helper that reads the handoff file and turns it into ordered repository scope plus warnings. This task should stop at the resolution boundary so the later execution task can consume one clear helper instead of mixing file parsing, selector lookup, and re-ingest execution together.

#### Documentation Locations

- Context7 `/nodejs/node/v22.17.0` - use for Node 22 filesystem and path APIs that read `current-plan.json`, parse JSON from disk, normalize paths, and support the `node:test` resolver coverage for fallback and warning cases.

#### Subtasks

1. [x] Current Repository: Create `server/src/ingest/planScopeResolver.ts` to read `<working-repo>/codeInfoStatus/flow-state/current-plan.json`, extract `additional_repositories[].path`, keep the working repository first, preserve file order for additional repositories, remove duplicates, and return the warning data defined in this story for missing, malformed, unreadable, or unusable handoff entries. Read/update: `server/src/ingest/planScopeResolver.ts`, `codeInfoStatus/flow-state/current-plan.json`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: Context7 /nodejs/node/v22.17.0.
2. [x] Current Repository: Keep `server/src/ingest/planScopeResolver.ts` at the resolution boundary only. It must not start re-ingest work, must not rewrite `current-plan.json`, and must resolve extra repository entries through the existing selector/normalization seams in `server/src/mcpCommon/repositorySelector.ts`, `server/src/ingest/pathMap.ts`, and `server/src/workingFolders/state.ts` instead of inventing a new direct-filesystem selection path. Read/update: `server/src/ingest/planScopeResolver.ts`, `server/src/mcpCommon/repositorySelector.ts`, `server/src/ingest/pathMap.ts`, `server/src/workingFolders/state.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
3. [x] Current Repository: Unit test addition: `server/src/test/unit/planScopeResolver.test.ts`. Purpose: prove missing handoff, unreadable handoff, and malformed JSON all resolve to warning-style fallback instead of hard failure. Read/update: `server/src/test/unit/planScopeResolver.test.ts`, `server/src/test/support/planScopeFixture.ts`, `server/src/ingest/planScopeResolver.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
4. [x] Current Repository: Unit test addition: `server/src/test/unit/planScopeResolver.test.ts`. Purpose: prove the happy path for `additional_repositories`, including working-repository-first ordering, empty-list fallback without handoff warnings, first-seen de-duplication of repeated repository entries, and ignoring unrelated handoff fields such as `plan_path` and `branched_from`. Read/update: `server/src/test/unit/planScopeResolver.test.ts`, `server/src/test/support/planScopeFixture.ts`, `server/src/ingest/planScopeResolver.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
5. [x] Current Repository: Unit test addition: `server/src/test/unit/planScopeResolver.test.ts`. Purpose: prove structurally invalid `additional_repositories` content is treated as `handoff_invalid` working-only fallback, and that dropped duplicate repository entries are surfaced through `repository_skipped` warnings instead of attempted repositories. Read/update: `server/src/test/unit/planScopeResolver.test.ts`, `server/src/test/support/planScopeFixture.ts`, `server/src/ingest/planScopeResolver.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
6. [x] Current Repository: Markdown update: `projectStructure.md`. Purpose: document the new files created by this task, including `server/src/ingest/planScopeResolver.ts` and `server/src/test/unit/planScopeResolver.test.ts`, after those files exist and before the task is marked complete. Read/update: `projectStructure.md`, `server/src/ingest/planScopeResolver.ts`, `server/src/test/unit/planScopeResolver.test.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
7. [x] Current Repository: Update this story file if the implemented helper contract in `server/src/ingest/planScopeResolver.ts` produces a clearer warning shape or return type than the current wording, so Tasks 4 and 5 can depend on one explicit documented contract. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, `server/src/ingest/planScopeResolver.ts`. Documentation: Context7 /nodejs/node/v22.17.0.
8. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T3:plan-scope-resolver` in the resolver path touched by this task. Expected Manual Playwright-MCP logs-page outcome: the marker appears for both a clean working-only resolution and a warning-producing handoff resolution, so the logs confirm repository ordering, fallback, and ignored handoff-field behavior. Read/update: `server/src/ingest/planScopeResolver.ts`, `server/src/test/unit/planScopeResolver.test.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: Context7 /nodejs/node/v22.17.0.
9. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
10. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 3 adds a server-side resolver helper. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper instead of raw `node:test` commands because Task 3 changes resolver logic covered by server unit and integration suites. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.

#### Implementation notes

- Added `server/src/ingest/planScopeResolver.ts` to resolve the working repository plus any valid `additional_repositories[].path` entries into ordered plan-scope repository input with warning metadata.
- Kept the helper at the resolution boundary by limiting it to working-folder normalization, handoff reads, selector reuse, de-duplication, warnings, and proof logging without starting re-ingest execution.
- Added resolver coverage for missing, unreadable, and malformed handoff files so those cases degrade to working-only results with warnings instead of throwing hard failures.
- Added resolver coverage for working-first ordering, empty-list clean fallback, duplicate handling, and ignored handoff fields such as `plan_path` and `branched_from`.
- Added resolver coverage for structurally invalid `additional_repositories` payloads and duplicate/unusable additional repositories so they surface through `handoff_invalid` or `repository_skipped` warnings instead of attempted repositories.
- Added the `DEV-0000052:T3:plan-scope-resolver` proof marker for both clean and warning-producing resolution outcomes.
- Updated `projectStructure.md` for the new resolver helper and its unit suite.
- The implemented resolver contract matched the planned Task 3 boundary closely enough that no extra story wording change was needed before Task 4 consumes it.
- `npm run lint` initially failed on one import-order warning in the new resolver test, and rerunning after fixing that warning passed cleanly.
- `npm run format:check` initially failed on the new resolver test, so `npm run format` was run before rerunning `npm run format:check` successfully.
- `npm run build:summary:server` finished with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- `npm run test:summary:server:unit` finished with `tests run: 1474`, `failed: 0`, and `agent_action: skip_log`, confirming the resolver helper integrates cleanly with the full server unit suite.

---

### Task 4. Implement Working And Plan-Scope Execution

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `f03fabd6, 713af736, 1bc5729e`

#### Overview

Implement the actual runtime execution contract for `working` and `plan_scope` inside the re-ingest layer. This task should stop at the execution result boundary: it should not yet change the persisted chat/lifecycle message contract.

#### Documentation Locations

- Context7 `/nodejs/node/v22.17.0` - use for Node 22 runtime behavior around filesystem reads, path handling, promise-based error propagation, and test coverage patterns that the re-ingest execution layer relies on.
- Context7 `/mermaid-js/mermaid` - use for Mermaid flowchart and sequence-diagram syntax when updating `design.md` to document the new `working` and `plan_scope` execution paths.

#### Subtasks

1. [x] Current Repository: In `server/src/ingest/reingestExecution.ts`, replace the runtime type contract in place. `ReingestRequest` and `ReingestTargetMode` must support `sourceId`, `working`, and `plan_scope` only. The single-result shape must represent `sourceId` and `working`, and the batch-result shape must represent `plan_scope` with ordered `repositories`, `summary`, and `warnings`. Read/update: `server/src/ingest/reingestExecution.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
2. [x] Current Repository: Extend the `executeReingestRequest` input contract in `server/src/ingest/reingestExecution.ts` so callers can supply the already-selected run working-repository path directly. This runtime seam must stop depending on `currentOwnerSourceId` for the new workflow-based targets, because Tasks 6 and 7 need one explicit `workingRepositoryPath` input they can pass from direct-command and flow runs. Read/update: `server/src/ingest/reingestExecution.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
3. [x] Current Repository: Replace the owner-based `current` branch in `server/src/ingest/reingestExecution.ts` with a `working` branch that uses the already-selected run `working_folder`, reuses the existing path mapping and working-folder validation seams from `server/src/workingFolders/state.ts` and `server/src/ingest/pathMap.ts`, fails before start when no usable working repository is available, and fails clearly when that repository is not currently ingested. Read/update: `server/src/ingest/reingestExecution.ts`, `server/src/workingFolders/state.ts`, `server/src/ingest/pathMap.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
4. [x] Current Repository: Replace the old `all` batch branch in `server/src/ingest/reingestExecution.ts` with `plan_scope` behavior that calls `server/src/ingest/planScopeResolver.ts`, attempts only resolved repositories, keeps `working` first and `additional_repositories` in file order, continues after per-repository failures, and returns the planned warning array without inserting skipped-at-resolution repositories into the attempted `repositories` list. Read/update: `server/src/ingest/reingestExecution.ts`, `server/src/ingest/planScopeResolver.ts`, `codeInfoStatus/flow-state/current-plan.json`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
5. [x] Current Repository: Remove or rename every obsolete `current` / `all` helper, branch, and error path in `server/src/ingest/reingestExecution.ts` so the removed literals do not survive in runtime type names, helper names, or dead compatibility code. Read/update: `server/src/ingest/reingestExecution.ts`, `server/src/ingest/reingestError.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
6. [x] Current Repository: Update execution-layer logs and step metadata in `server/src/ingest/reingestExecution.ts` so `working`, `plan_scope`, working-only fallback, skipped-at-resolution repositories, and continue-after-failure batches can be distinguished clearly during diagnosis. Read/update: `server/src/ingest/reingestExecution.ts`, `server/src/test/unit/reingestExecution.test.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
7. [x] Current Repository: Preserve explicit `sourceId` behavior and keep the MCP-facing selector model unchanged. Do not add `working` or `plan_scope` semantics to the MCP contract while editing the shared execution code. Read/update: `server/src/ingest/reingestExecution.ts`, `server/src/mcp2/tools/reingestRepository.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
8. [x] Current Repository: Unit test update: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove explicit selector-based `sourceId` re-ingest still canonicalizes valid selectors and returns the same single-result contract after the new target modes are added. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
9. [x] Current Repository: Unit test update: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove unresolved or invalid `sourceId` inputs still stay on the strict invalid-input path and do not fall into `working` or `plan_scope` handling. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
10. [x] Current Repository: Unit test update: `server/src/test/unit/mcp.reingest.classic.test.ts`. Purpose: prove the classic MCP `reingest_repository` tool remains `sourceId`-only and does not accept `target: "working"` or `target: "plan_scope"` arguments after the shared execution changes. Read/update: `server/src/test/unit/mcp.reingest.classic.test.ts`, `server/src/mcp/tools.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
11. [x] Current Repository: Unit test update: `server/src/test/unit/mcp2.reingest.tool.test.ts`. Purpose: prove the MCP v2 `reingest_repository` tool remains `sourceId`-only and does not accept `target: "working"` or `target: "plan_scope"` arguments after the shared execution changes. Read/update: `server/src/test/unit/mcp2.reingest.tool.test.ts`, `server/src/mcp2/tools/reingestRepository.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
12. [x] Current Repository: Unit test addition: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove the `working` happy path resolves the selected working repository and completes as a single-repository execution. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
13. [x] Current Repository: Unit test addition: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove both `working` and `plan_scope` fail before start when the working repository is missing or not currently ingested, and that handoff fallback logic is never used when the required working repository itself is unusable. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`, `server/src/workingFolders/state.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
14. [x] Current Repository: Unit test addition: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove the `plan_scope` happy path uses working-first ordering, file-order additional repositories, and first-seen de-duplication. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`, `server/src/test/support/planScopeFixture.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
15. [x] Current Repository: Unit test addition: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove missing, malformed, unreadable, or structurally invalid handoff inputs fall back to working-only execution with the correct warning behavior instead of aborting the batch, and that empty or absent `additional_repositories` stays a clean working-only path without a handoff warning. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`, `server/src/test/support/planScopeFixture.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
16. [x] Current Repository: Unit test addition: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove invalid additional repositories are skipped at resolution, appear only in warnings, and do not enter the attempted `repositories` array or `summary` counts. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`, `server/src/test/support/planScopeFixture.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
17. [x] Current Repository: Unit test addition: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove an attempted repository failure records `repository_failed`, later repositories still run in order, and the final batch result remains a completed batch payload rather than a hard execution abort. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`, `server/src/test/support/planScopeFixture.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
18. [x] Current Repository: Unit test addition: `server/src/test/unit/reingestExecution.test.ts`. Purpose: prove execution-layer logs and metadata distinguish working-only fallback, skipped-at-resolution repositories, and degraded batch completion clearly enough for later command/flow diagnostics. Read/update: `server/src/test/unit/reingestExecution.test.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
19. [x] Current Repository: Markdown update: `design.md`. Purpose: document the execution-layer architecture change from owner-based `current` / `all` to `working` / `plan_scope`, and add or update Mermaid diagrams that show the single-target branch, the plan-scope resolution order, and the continue-after-failure batch path. Read/update: `design.md`, `server/src/ingest/reingestExecution.ts`, Context7 `/mermaid-js/mermaid`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
20. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T4:reingest-execution` in the execution path touched by this task. Expected Manual Playwright-MCP logs-page outcome: the marker appears with `targetMode`, attempted-repository counts, and warning counts for both `working` and `plan_scope`, confirming execution ordering and best-effort batch behavior. Read/update: `server/src/ingest/reingestExecution.ts`, `server/src/test/unit/reingestExecution.test.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
21. [x] Current Repository: Repair the loop-test teardown prerequisite in `server/src/test/integration/flows.run.loop.test.ts` so every flow-starting scenario reaches deterministic terminal cleanup before deleting memory state. Replace bare success-path `cleanupMemory(...)` calls with `cleanupConversationRuntime(...)` or an equivalent wait-for-terminal-final plus runtime-drain sequence, and keep the existing `closeWs(...)`, `wsHandle.close()`, and `httpServer.close(...)` ordering intact. This prerequisite exists because the full Task 4 server-unit wrapper is not honestly runnable until the known full-suite hang surface is hardened. Read/update: `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/support/wsClient.ts`, `server/src/ws/server.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: Context7 /nodejs/node/v22.17.0 ; Context7 `/websockets/ws`.
22. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
23. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 4 changes the core server re-ingest execution runtime. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: After Subtask 21 lands, run `npm run test:summary:server:unit -- --file src/test/integration/flows.run.loop.test.ts`. Use this targeted wrapper first because the known blocker is a full-suite hang rooted in this file's cleanup path, and this proof step must show the loop test exits cleanly on its own before the full suite is trusted again. If this targeted wrapper still hangs or fails, diagnose `server/src/test/integration/flows.run.loop.test.ts` before attempting the full wrapper.
3. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this full wrapper only after Testing step 2 passes, because Task 4 changes server execution, helper, and integration behavior and the loop-test cleanup prerequisite must already be proven. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.
4. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper instead of raw Cucumber commands because Task 4 changes runtime behavior that can surface in feature-level server flows. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- `server/src/test/unit/reingestExecution.test.ts` already proves explicit `sourceId` selectors still canonicalize to the resolved container path and stay on the strict invalid-input path when lookup fails, so those two preservation subtasks were marked complete during this audit.
- `server/src/ingest/reingestExecution.ts` now exposes only `sourceId`, `working`, and `plan_scope`, with batch payloads returning ordered attempted repositories plus explicit `summary` and `warnings`.
- `executeReingestRequest(...)` now accepts `workingRepositoryPath`, validates the selected working repository before start for `working` and `plan_scope`, and emits `DEV-0000052:T4:reingest-execution` for both single and batch execution paths.
- `server/src/test/unit/reingestExecution.test.ts` now covers working-path success, missing or not-ingested working-repository failures, resolver-backed plan-scope ordering, working-only fallback warnings, skipped-at-resolution repositories, continue-after-failure batches, and execution-layer log metadata.
- Classic and MCP v2 guard tests now prove `reingest_repository` remains `sourceId`-only, and `design.md` now documents the execution-layer shift from owner-based `current` / `all` to `working` / `plan_scope`.
- `npm run lint` passed cleanly after the Task 4 execution, test, MCP guard, and design changes landed.
- `npm run format:check` initially flagged the touched execution files, so `npm run format` was run and the formatting check now passes cleanly.
- `npm run build:summary:server` initially failed on compile-time test fixture drift (`current` / `all` execution fixtures and missing batch `summary`/`warnings`), and the rerun passed cleanly after those compatibility fixes landed.
- Command and flow tests that still relied on owner-based `working` / `plan_scope` behavior were updated to the Task 4 fail-fast expectation until Tasks 6 and 7 wire explicit `workingRepositoryPath` through those surfaces.
- Historical blocker context: Testing step 3 (`npm run test:summary:server:unit`) previously stalled in `agent_action: wait` far past the documented 12-minute budget. The diagnosis traced the long-running child to `node --test --test-concurrency=1 src/test/integration/flows.run.loop.test.ts`, which led to the loop-test cleanup repair and targeted rerun documented below.
- **BLOCKING ANSWER**
  - Repository precedents found:
    - `server/src/test/support/wsClient.ts` already gives the repo-preferred deterministic WebSocket teardown surface through `closeWs(...)` and `waitForClose(...)`, each with their own timeouts.
    - `server/src/test/integration/flows.run.command.test.ts` and `server/src/test/integration/agents-run-ws-cancel.test.ts` show the preferred cleanup shape for long-running flow tests: use `try/finally`, wait for runtime state to drain, then tear down WebSocket and HTTP handles instead of relying on the wrapper to kill the process.
    - `scripts/summary-wrapper-protocol.mjs` and `scripts/test-summary-server-unit.mjs` prove the wrapper has no watchdog or forced kill path. It only reports `agent_action: wait` until the child exits, so leaked handles must be fixed in the tests or runtime, not in the wrapper.
  - External library precedents found:
    - Node v22 `node:test` docs say test timeouts default to `Infinity`, so a hanging integration suite will not fail by itself unless the test finishes or its own timeout/cleanup path fires.
    - Node HTTP docs say `server.close()` stops new connections and, on modern Node, closes idle HTTP connections, but upgraded sockets are a separate concern.
    - The official `ws` docs say `WebSocketServer.close()` does not terminate existing active clients automatically when an external HTTP server is used, and `WebSocket#terminate()` is the immediate close path when graceful close is not enough.
  - Issue-resolution references found:
    - A targeted rerun with `npm run test:summary:server:unit -- --file src/test/integration/flows.run.loop.test.ts` completed cleanly with `16` tests run and `0` failed, so the named file is diagnosable in isolation and the blocker is a full-suite leak or ordering problem rather than a permanently broken Task 4 runtime seam.
    - Direct inspection of `server/src/test/integration/flows.run.loop.test.ts` shows several success-path tests still end with `cleanupMemory(...)` immediately after partial assertions such as `waitForTurns(...)`, while the stop/cancel paths already use `cleanupConversationRuntime(...)`. That means some loop tests can drop persisted memory state before the flow runtime and WebSocket ownership have drained fully.
    - The `ws` maintainers' guidance and issue history both point the same way: do not assume server close will tear down all live clients; close or terminate them explicitly when you need deterministic test shutdown.
  - Chosen fix:
    - Repair `server/src/test/integration/flows.run.loop.test.ts` so every test that starts a flow waits for terminal flow cleanup before deleting memory state. In practice, the success-path loop tests should stop using bare `cleanupMemory(...)` and should either await the terminal `turn_final` event or call `cleanupConversationRuntime(...)` before teardown, matching the repo's existing explicit-cleanup pattern.
    - Keep the wrapper unchanged and use the existing targeted `--file` / `--test-name` wrapper reruns for diagnosis first, then rerun the full `npm run test:summary:server:unit` wrapper once the loop-test cleanup is hardened.
  - Why this fits the current repo state:
    - It uses cleanup helpers the repo already has instead of inventing a new kill switch.
    - It addresses the actual leak surface that can survive into the full suite: unfinished flow runtime ownership, inflight state, and live upgraded WebSocket handles.
    - It matches the evidence that the isolated loop file passes, so the next fix belongs in deterministic teardown and suite interaction, not in the re-ingest execution code added by Task 4.
  - Rejected alternatives:
    - Do not add a wrapper watchdog or forced child kill. That would hide leaked handles and make later regressions harder to diagnose.
    - Do not rely on `forceExit`, blind process termination, or reading the live wrapper log while `do_not_read_log: true`; those are temporary workarounds or anti-patterns, not a proper fix.
    - Do not treat this as a Task 4 design flaw. The blocker is local to the proof path and test cleanup behavior, not to the `working` / `plan_scope` execution contract itself.
  - Story repair made after this research:
    - Task 4 now includes an explicit loop-test-cleanup prerequisite and a targeted loop-file wrapper gate before the full server-unit wrapper. This was added because the blocker proved the original Task 4 proof path was incomplete: the task assumed the full unit wrapper was runnable without first repairing the known cleanup leak in `server/src/test/integration/flows.run.loop.test.ts`.
- Subtask 21 is now complete: `server/src/test/integration/flows.run.loop.test.ts` no longer drops flow memory immediately after partial success assertions, and the success-path cleanup sites now await `cleanupConversationRuntime(...)` so inflight ownership drains before memory deletion. The existing `closeWs(...)`, `wsHandle.close()`, and `httpServer.close(...)` teardown ordering in `closeFlowHarness(...)` was left unchanged.
- Testing step 2 passed with `npm run test:summary:server:unit -- --file src/test/integration/flows.run.loop.test.ts`, reporting `16` tests run and `0` failed. That confirms the repaired loop-test file exits cleanly under the wrapper before the full Task 4 unit suite rerun.
- Testing step 3 now passes cleanly with `npm run test:summary:server:unit`, reporting `1483` tests run and `0` failed after fixing the loop cleanup prerequisite, the `plan_scope` batch lifecycle parsing regression, and a suite-only codex MCP websocket timeout edge. The loop-test hang is resolved, although the full wrapper still ran past its nominal 12-minute budget while continuing to make forward progress through later test files.
- Testing step 4 passed with `npm run test:summary:server:cucumber`, reporting `75` tests run and `0` failed. That completed the Task 4 validation path after the unit wrapper rerun proved the execution changes, loop-test teardown repair, and follow-up regression fixes all hold together.

---

### Task 5. Implement The Re-Ingest Message And Persistence Contract

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `b51e3b92`

#### Overview

Update the server-side tool-result and lifecycle message contract so completed `plan_scope` batches can be published and persisted as success-with-warnings without breaking historical payload reads. This task is intentionally separate from the execution task because the message/persistence contract is its own testable server output.

#### Documentation Locations

- `https://mongoosejs.com/docs/schematypes.html` - use for `Schema.Types.Mixed`, especially the documented change-tracking caveat that explains why this story should keep using the existing fresh write path instead of introducing in-place mutation logic.
- Context7 `/nodejs/node/v22.17.0` - use for Node 22 test/runtime behavior while updating the tool-result and lifecycle tests around persisted payloads.
- Context7 `/mermaid-js/mermaid` - use for Mermaid sequence-diagram syntax when documenting the tool-result, lifecycle, and persistence flow in `design.md`.

#### Subtasks

1. [x] Current Repository: Update `server/src/chat/reingestToolResult.ts` so single re-ingest payloads use `targetMode: "sourceId" | "working"` and batch payloads use `targetMode: "plan_scope"` with the ordered attempted `repositories`, `summary`, and explicit `warnings` array described in this story. Read/update: `server/src/chat/reingestToolResult.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
2. [x] Current Repository: Keep `ChatToolResultEvent.stage` on the existing `success` / `error` enum in `server/src/chat/interfaces/ChatInterface.ts`. Represent success-with-warnings as `stage: "success"` plus a populated warnings array in the batch payload instead of inventing a third stage value. Read/update: `server/src/chat/interfaces/ChatInterface.ts`, `server/src/chat/reingestToolResult.ts`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
3. [x] Current Repository: Update `server/src/chat/reingestStepLifecycle.ts` so it accepts, persists, and publishes the new batch payload shape while still reading historical stored payloads that contain `targetMode: "current"` or `targetMode: "all"`. The lifecycle path must keep old transcripts readable even though new writes use only `working` and `plan_scope`. Read/update: `server/src/chat/reingestStepLifecycle.ts`, `server/src/chat/reingestToolResult.ts`, `server/src/mongo/turn.ts`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
4. [x] Current Repository: Update lifecycle-generated transcript text in `server/src/chat/reingestStepLifecycle.ts` so `plan_scope` is not described as "all ingested repositories", and so warning-style completion is visible in the saved user/assistant turns without converting the whole batch into a hard error. Read/update: `server/src/chat/reingestStepLifecycle.ts`, `server/src/test/unit/reingest-step-lifecycle.test.ts`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
5. [x] Current Repository: Confirm in `server/src/mongo/turn.ts` that no new top-level Mongo field or collection is needed because the payload still lives under `Turn.toolCalls`. Keep writes on the existing fresh `appendTurn` path and do not introduce an in-place `markModified('toolCalls')` flow for `Schema.Types.Mixed`. Read/update: `server/src/mongo/turn.ts`, `server/src/chat/reingestStepLifecycle.ts`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
6. [x] Current Repository: Unit test update: `server/src/test/unit/reingest-tool-result.test.ts`. Purpose: prove single and batch payload shaping uses the new `targetMode` values and keeps completed warning-style `plan_scope` batches on `stage: "success"`. Read/update: `server/src/test/unit/reingest-tool-result.test.ts`, `server/src/chat/reingestToolResult.ts`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
7. [x] Current Repository: Unit test update: `server/src/test/unit/reingest-tool-result.test.ts`. Purpose: prove the concrete warning-code payloads `handoff_missing`, `handoff_invalid`, `repository_skipped`, and `repository_failed` include the expected `repositoryPath` / `resolvedRepositoryId` fields. Read/update: `server/src/test/unit/reingest-tool-result.test.ts`, `server/src/chat/reingestToolResult.ts`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
8. [x] Current Repository: Unit test update: `server/src/test/unit/reingest-step-lifecycle.test.ts`. Purpose: prove warning-style batches persist correctly, produce transcript-facing warning text, and do not degrade into hard error turns. Read/update: `server/src/test/unit/reingest-step-lifecycle.test.ts`, `server/src/chat/reingestStepLifecycle.ts`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
9. [x] Current Repository: Unit test update: `server/src/test/unit/reingest-step-lifecycle.test.ts`. Purpose: prove historical payload compatibility for stored `current` / `all` data so older transcripts remain readable after the new contract lands. Read/update: `server/src/test/unit/reingest-step-lifecycle.test.ts`, `server/src/chat/reingestStepLifecycle.ts`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
10. [x] Current Repository: Markdown update: `design.md`. Purpose: document the warning-aware tool-result and persistence architecture, and add or update Mermaid diagrams that show execution result shaping, lifecycle publication, and storage in `Turn.toolCalls`. Read/update: `design.md`, `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, Context7 `/mermaid-js/mermaid`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
11. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T5:reingest-lifecycle` in the tool-result or lifecycle path touched by this task. Expected Manual Playwright-MCP logs-page outcome: the marker appears with `stage: "success"`, the final `targetMode`, and `warningCount`, confirming success-with-warnings payloads were published and persisted correctly. Read/update: `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://mongoosejs.com/docs/schematypes.html ; Context7 /nodejs/node/v22.17.0.
12. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
13. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 5 changes server lifecycle and persistence code. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper instead of raw `node:test` commands because Task 5 changes server unit and integration behavior around tool results and persistence. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper instead of raw Cucumber commands because Task 5 changes persisted server output that can affect feature-level transcripts. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtasks 1 and 2 are complete: `server/src/chat/reingestToolResult.ts` now writes `working` / `plan_scope` payloads, carries explicit batch `warnings`, and keeps success-with-warnings on `stage: "success"` instead of inventing a new tool-result stage.
- Subtasks 3 and 4 are complete: `server/src/chat/reingestStepLifecycle.ts` now normalizes historical `current` / `all` payloads for reading, writes plan-scope-specific transcript text, and makes warning-style completion visible without converting the batch into a hard error.
- Subtask 5 is complete: `server/src/mongo/turn.ts` still keeps re-ingest payloads under `Turn.toolCalls`, so no new top-level Mongo field or `markModified('toolCalls')` path was needed.
- Subtasks 6 through 9 are complete: the Task 5 unit tests now cover success-with-warnings payload shaping, explicit warning metadata fields, transcript-facing warning text, and historical `current` / `all` payload compatibility.
- Subtasks 10 and 11 are complete: `design.md` now documents the warning-aware lifecycle contract, and `DEV-0000052:T5:reingest-lifecycle` is emitted with `stage`, `targetMode`, and `warningCount`.
- Subtask 12 is complete: `npm run lint` passed after one import-order warning in `server/src/chat/reingestToolResult.ts` was corrected manually.
- Subtask 13 is complete: `npm run format:check` initially flagged the touched Task 5 files, so `npm run format` was run and the formatting check now passes cleanly.
- Testing step 1 passed with `npm run build:summary:server` after one TypeScript warning-code narrowing fix in `server/src/chat/reingestStepLifecycle.ts`. The rerun finished cleanly with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2 passed with `npm run test:summary:server:unit`, reporting `1485` tests run and `0` failed. The full wrapper again ran longer than its nominal 12-minute budget, but it continued making forward progress through later files and finished cleanly.
- Testing step 3 passed with `npm run test:summary:server:cucumber`, reporting `75` tests run and `0` failed. That completed the Task 5 validation path after the build and unit wrappers proved the warning-aware payload and lifecycle contract held across the broader server suite.

---

### Task 6. Wire Direct Commands To The New Runtime Contract

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `47000b26`, `5285e81f`

#### Overview

Wire the new schema, execution, and message contracts into direct command execution only. This task should prove the end-to-end behavior for direct command re-ingest before the story moves on to top-level flow steps and flow-owned command items.

#### Documentation Locations

- `https://expressjs.com/en/5x/api` - use for Express 5 request handlers, routing methods, and middleware callback behavior used by the direct-command server surface.
- `https://expressjs.com/en/guide/using-middleware.html` - use for the application-level and router-level middleware flow, including `next()` semantics, which matters when the direct-command path threads working-folder context through the server runtime.
- Context7 `/nodejs/node/v22.17.0` - use for the Node 22 server-test runtime that backs the direct-command unit and integration suites.

#### Subtasks

1. [x] Current Repository: Update `server/src/agents/commandsRunner.ts` so direct-command re-ingest items pass the explicit runtime `workingRepositoryPath` added in Task 4 and the new `targetMode` values into `executeReingestRequest`. Keep the direct-command surface aligned with the new runtime contract rather than reconstructing owner-based `current` behavior locally. Read/update: `server/src/agents/commandsRunner.ts`, `server/src/agents/service.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
2. [x] Current Repository: Search the checked-in agent command folders for existing command assets that can safely drive the new direct-command `working` and `plan_scope` behaviors on the compose stack. If suitable assets do not already exist, create two minimal proof-owned commands such as `codex_agents/tasking_agent/commands/reingest_working.json` and `codex_agents/tasking_agent/commands/reingest_plan_scope.json`, each with a single re-ingest item using `target: "working"` or `target: "plan_scope"` respectively, and keep them free of unrelated message steps so Tasks 8 and 9 can invoke both targets over HTTP without requiring model output. Read/update: `codex_agents/tasking_agent/commands/reingest_working.json`, `codex_agents/tasking_agent/commands/reingest_plan_scope.json`, `codex_agents/tasking_agent/commands`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
3. [x] Current Repository: Unit test update: `server/src/test/unit/agent-commands-runner.test.ts`. Purpose: prove direct commands emit the correct `working` target-mode logging and lifecycle data on the happy path. Read/update: `server/src/test/unit/agent-commands-runner.test.ts`, `server/src/agents/commandsRunner.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
4. [x] Current Repository: Unit test update: `server/src/test/unit/agent-commands-runner.test.ts`. Purpose: prove direct commands surface `plan_scope` batch warnings and no longer reference removed `current` / `all` wording. Read/update: `server/src/test/unit/agent-commands-runner.test.ts`, `server/src/agents/commandsRunner.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
5. [x] Current Repository: Integration test update: `server/src/test/integration/commands.reingest.test.ts`. Purpose: prove the direct-command `working` happy path plus the pre-start error paths for both `working` and `plan_scope` when the required working repository is missing or not currently ingested. Read/update: `server/src/test/integration/commands.reingest.test.ts`, `server/src/agents/commandsRunner.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
6. [x] Current Repository: Integration test update: `server/src/test/integration/commands.reingest.test.ts`. Purpose: prove the direct-command `plan_scope` happy path, missing/malformed handoff fallback, and invalid additional repository warnings through the HTTP/runtime surface. Read/update: `server/src/test/integration/commands.reingest.test.ts`, `server/src/test/support/planScopeFixture.ts`, `server/src/agents/commandsRunner.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
7. [x] Current Repository: Integration test update: `server/src/test/integration/commands.reingest.test.ts`. Purpose: prove a direct-command `plan_scope` batch stays on tool-result `stage: "success"`, persists/publishes `targetMode: "plan_scope"` plus `warnings`, and still continues to later repositories after an attempted repository failure. Read/update: `server/src/test/integration/commands.reingest.test.ts`, `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, `server/src/agents/commandsRunner.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
8. [x] Current Repository: Integration test update: `server/src/test/integration/commands.reingest.test.ts`. Purpose: prove direct-command transcript-facing text no longer says "all ingested repositories" and instead reflects the new `working` / warning-aware `plan_scope` wording visible to downstream consumers. Read/update: `server/src/test/integration/commands.reingest.test.ts`, `server/src/chat/reingestStepLifecycle.ts`, `server/src/agents/commandsRunner.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
9. [x] Current Repository: Markdown update: `projectStructure.md`. Purpose: if Task 6 creates new checked-in proof commands such as `codex_agents/tasking_agent/commands/reingest_working.json` and `codex_agents/tasking_agent/commands/reingest_plan_scope.json`, document those files after they exist so Tasks 8 and 9 can locate them without rediscovering the command paths. If Task 6 reuses existing checked-in commands instead, record that no new project-structure entry was needed in the Implementation notes. Read/update: `projectStructure.md`, `codex_agents/tasking_agent/commands/reingest_working.json`, `codex_agents/tasking_agent/commands/reingest_plan_scope.json`, or the reused command files, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
10. [x] Current Repository: Update this story file if direct-command wiring in `server/src/agents/commandsRunner.ts`, the chosen checked-in proof commands, or `server/src/test/integration/commands.reingest.test.ts` reveals a real behavior difference from the documented contract, so Tasks 7 through 9 inherit the corrected description. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, `server/src/agents/commandsRunner.ts`, the chosen checked-in proof command files. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0.
11. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T6:direct-command-reingest` in the direct-command runtime path and proof assets touched by this task. Expected Manual Playwright-MCP logs-page outcome: the marker appears once for the `working` proof command and once for the `plan_scope` proof command, each with `surface: "direct_command"`, `commandName`, and the expected `targetMode`. Read/update: `server/src/agents/commandsRunner.ts`, `codex_agents/tasking_agent/commands/reingest_working.json`, `codex_agents/tasking_agent/commands/reingest_plan_scope.json`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://expressjs.com/en/5x/api ; Context7 /nodejs/node/v22.17.0.
12. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
13. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 6 changes direct-command server wiring. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper instead of raw `node:test` commands because Task 6 changes direct-command server behavior covered by unit and integration suites. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper instead of raw Cucumber commands because Task 6 changes server command execution behavior that can affect feature-level command flows. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: `server/src/agents/commandsRunner.ts` now forwards `working_folder` into `executeReingestRequest`, keeping direct commands on the shared Task 4 runtime seam instead of reconstructing owner-based fallback locally.
- Subtask 2: Searched the checked-in command folders, confirmed there were no reusable re-ingest proof commands, and added minimal `tasking_agent` proof commands for `working` and `plan_scope`.
- Subtask 3: Added a direct runner unit test that proves `target: "working"` uses the selected `working_folder`, records lifecycle data as `targetMode: "working"`, and emits the Task 6 direct-command log marker.
- Subtask 4: Added a direct runner unit test that proves `target: "plan_scope"` keeps removed `current` / `all` wording out of lifecycle payloads, carries batch warnings, and still logs as a direct-command plan-scope run.
- Subtask 5: Expanded `commands.reingest` integration coverage to prove the direct-command `working` happy path plus the missing-working-folder and not-currently-ingested pre-start failures for both new targets.
- Subtask 6: Added direct-command `plan_scope` integration coverage for working-first execution, missing and malformed handoff fallback, and skipped-additional-repository warnings using the shared plan-scope fixture harness.
- Subtask 7: Added a websocket-backed direct-command proof that keeps `plan_scope` on tool-result `stage: "success"`, persists batch `warnings`, and continues to later repositories after an attempted repository failure.
- Subtask 8: The new direct-command integration proof now checks the assistant transcript wording directly and confirms the removed "all ingested repositories" text no longer appears.
- Subtask 9: Documented the two new checked-in `tasking_agent` proof commands in `projectStructure.md` so the compose and `/logs` proof tasks can reuse stable command paths.
- Subtask 10: Re-read the updated direct-command behavior against the story contract and did not find a Task 6-only behavior drift that required changing the documented story requirements.
- Subtask 11: Added the `DEV-0000052:T6:direct-command-reingest` log marker in the direct-command re-ingest path so later `/logs` proof can distinguish `working` and `plan_scope` command runs by `commandName` and `targetMode`.
- Subtask 12: `npm run lint` initially failed on one import-order warning in `server/src/chat/reingestStepLifecycle.ts`; ran `npm run lint:fix` and reran `npm run lint` cleanly.
- Subtask 13: `npm run format:check` initially reported the new direct-command test files; ran `npm run format` and reran `npm run format:check` cleanly.
- Testing 1: `npm run build:summary:server` passed with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing 2: `npm run test:summary:server:unit` initially exposed two Task 6 assertion mismatches in the new `plan_scope` integration tests; fixed the warning-shape and transcript expectations, proved the file with a targeted wrapper rerun, and reran the full wrapper cleanly with `tests run: 1491` and `failed: 0`.
- Testing 3: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 75`, `failed: 0`, and `agent_action: skip_log`.

---

### Task 7. Wire Flow Re-Ingest Surfaces To The New Runtime Contract

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `bf7df3e3 DEV-0000052 - wire flow reingest runtime surfaces`; `9a41920a DEV-0000052 - mark task 7 git commits`; `8d8e95f3 DEV-0000052 - fix task 7 commit ledger`

#### Overview

Wire the new contract into top-level flow re-ingest steps and flow-owned command items. This task should prove that the flow runtime uses the same `working` and `plan_scope` behavior as direct commands without keeping any owner-based compatibility fallback.

#### Documentation Locations

- `https://expressjs.com/en/5x/api` - use for Express 5 routing and request-handler rules that apply to the flow run endpoints and any nested middleware callbacks they use.
- `https://expressjs.com/en/guide/using-middleware.html` - use for router middleware behavior and `next()` / `next('route')` flow, which is relevant when flow execution hands off between service layers and route handlers.
- Context7 `/nodejs/node/v22.17.0` - use for the Node 22 server-test runtime behind the flow integration suites.
- Context7 `/mermaid-js/mermaid` - use for Mermaid flowchart and sequence-diagram syntax when documenting flow re-ingest behavior in `design.md`.

#### Subtasks

1. [x] Current Repository: Update `server/src/flows/service.ts` so both top-level flow re-ingest steps and the flow-owned command `executeReingest` callback pass the explicit runtime `workingRepositoryPath` added in Task 4 into `executeReingestRequest`. Keep `server/src/agents/commandItemExecutor.ts` on its existing responsibility boundary by updating only the command-item delegation and target-mode logging it already owns. Do not create a new direct execution branch inside `commandItemExecutor.ts`. Read/update: `server/src/agents/commandItemExecutor.ts`, `server/src/flows/service.ts`, `server/src/ingest/reingestExecution.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
2. [x] Current Repository: Integration test update: `server/src/test/integration/flows.run.command.test.ts`. Purpose: prove top-level flow re-ingest steps use the `working` happy path and ordered `plan_scope` happy path the same way as direct commands. Read/update: `server/src/test/integration/flows.run.command.test.ts`, `server/src/flows/service.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
3. [x] Current Repository: Integration test update: `server/src/test/integration/flows.run.command.test.ts`. Purpose: prove flow-owned command items surface skipped-additional-repository warnings, attempted-repository failure followed by continued execution, and warning-aware completion for `plan_scope`. Read/update: `server/src/test/integration/flows.run.command.test.ts`, `server/src/agents/commandItemExecutor.ts`, `server/src/flows/service.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
4. [x] Current Repository: Integration test update: `server/src/test/integration/flows.run.command.test.ts`. Purpose: prove both top-level flow re-ingest steps and flow-owned command items persist/publish `targetMode: "plan_scope"` plus `warnings`, stay on tool-result `stage: "success"`, and no longer surface removed `current` / `all` wording in downstream flow-visible results. Read/update: `server/src/test/integration/flows.run.command.test.ts`, `server/src/chat/reingestToolResult.ts`, `server/src/chat/reingestStepLifecycle.ts`, `server/src/agents/commandItemExecutor.ts`, `server/src/flows/service.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
5. [x] Current Repository: Integration test update: `server/src/test/integration/flows.run.errors.test.ts`. Purpose: prove flow pre-start errors use the new `working` / `plan_scope` wording when the working folder is missing, invalid, or not currently ingested. Read/update: `server/src/test/integration/flows.run.errors.test.ts`, `server/src/flows/service.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
6. [x] Current Repository: Integration test update: `server/src/test/integration/flows.run.working-folder.test.ts`. Purpose: prove any flow working-folder restore or validation behavior that touches re-ingest still reflects the new working-repository semantics. Read/update: `server/src/test/integration/flows.run.working-folder.test.ts`, `server/src/flows/service.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
7. [x] Current Repository: Markdown update: `design.md`. Purpose: document how top-level flow re-ingest steps and flow-owned command items now route `working` / `plan_scope` through the shared runtime, and add or update Mermaid diagrams that show the flow service and command-item handoff. Read/update: `design.md`, `server/src/agents/commandItemExecutor.ts`, `server/src/flows/service.ts`, Context7 `/mermaid-js/mermaid`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
8. [x] Current Repository: Update this story file if the flow wiring in `server/src/agents/commandItemExecutor.ts` or `server/src/flows/service.ts` reveals a real cross-surface difference from direct-command behavior, so the documented contract stays explicit for later validation tasks. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, `server/src/agents/commandItemExecutor.ts`, `server/src/flows/service.ts`. Documentation: https://expressjs.com/en/5x/api ; https://expressjs.com/en/guide/using-middleware.html ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
9. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T7:flow-reingest` in the flow runtime path touched by this task. Expected Manual Playwright-MCP logs-page outcome: the marker appears with `surface: "flow"`, the flow-proof identifier, and the final `targetMode`, confirming the final validation pass covered both top-level flow re-ingest and flow-owned command routing. Read/update: `server/src/flows/service.ts`, `server/src/agents/commandItemExecutor.ts`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://expressjs.com/en/5x/api ; Context7 /nodejs/node/v22.17.0 ; Context7 /mermaid-js/mermaid.
10. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
11. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 7 changes flow-side server wiring. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper instead of raw `node:test` commands because Task 7 changes flow service and command-item server behavior covered by integration suites. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper instead of raw Cucumber commands because Task 7 changes flow-execution behavior that can surface in feature-level server coverage. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun full `npm run test:summary:server:cucumber`.

#### Implementation notes

- Subtask 1: `server/src/flows/service.ts` now forwards `repositoryContext.workingRepositoryPath` into both top-level flow re-ingest steps and flow-owned command re-ingest execution so flow surfaces use the same shared runtime seam as Task 6 direct commands.
- Subtask 9: Added the `DEV-0000052:T7:flow-reingest` marker in both flow-step and flow-command re-ingest paths, with `surface: "flow"` and per-path context for later `/logs` proof.
- Subtask 2: `server/src/test/integration/flows.run.command.test.ts` now proves dedicated flow `working` re-ingest succeeds against the selected working repository and dedicated `plan_scope` re-ingest keeps working-first plus handoff-file ordering.
- Subtask 3: Added flow-owned command `plan_scope` integration coverage for skipped-additional warnings, attempted-repository failure, and continued execution into later command items and later flow steps.
- Subtask 4: Flow integration coverage now asserts live `tool_event` publication plus persisted `toolCalls` keep `stage: "success"`, `targetMode: "plan_scope"`, explicit `warnings`, and updated transcript wording without resurrecting removed `current` / `all` text.
- Subtask 5: `server/src/test/integration/flows.run.errors.test.ts` now proves dedicated flow `working` / `plan_scope` runs fail before start with the new target wording when no working folder is selected or when the selected working repository is not currently ingested.
- Subtask 6: `server/src/test/integration/flows.run.working-folder.test.ts` now proves a validated `working_folder` is persisted and forwarded into a dedicated flow `target: "working"` re-ingest run instead of falling back to owner-based behavior.
- Subtask 7: Added a new Task 7 section to `design.md` with Mermaid flowchart and sequence diagrams showing both flow re-ingest surfaces converging on the shared runtime and lifecycle seam.
- Subtask 8: No cross-surface contract drift was discovered while wiring flow paths; this story file did not need a contract correction beyond the live Task 7 progress updates already recorded here.
- Subtask 10: `npm run lint` passed after fixing one syntax mistake in the new flow plan-scope integration test wiring before any broader wrapper validation started.
- Subtask 11: `npm run format:check` needed one `npm run format` pass for the new integration and working-folder tests, and the rerun then passed cleanly.
- Testing step 1: `npm run build:summary:server` initially failed because one new integration test called `startFlowRun(...)` with a non-existent `workingRepositoryPath` field; moving that check back through the flow route fixed the type error and the rerun passed with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`.
- Testing step 2: `npm run test:summary:server:unit` first exposed three new flow assertions; after adding missing working-folder directories and making the not-currently-ingested plan-scope proof use a stateful repository list, targeted wrapper reruns passed and the full wrapper rerun finished cleanly with `1497` tests run and `0` failed, though it still ran well past the nominal 12-minute budget while making steady forward progress.
- Testing step 3: `npm run test:summary:server:cucumber` passed cleanly with `75` tests run, `0` failed, and `agent_action: skip_log`, so the flow-surface wiring held through the higher-level server feature coverage as well.

---

### Task 8. Validate Working-Folder Environment And Mounted Runtime Access

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `d5317187 DEV-0000052 - validate mounted working-folder runtime`; `4ca614fc DEV-0000052 - mark task 8 git commits`; `317bcbf5 DEV-0000052 - fix task 8 commit ledger`

#### Overview

Prove the environment-sensitive and container-visible runtime assumptions that this story depends on. This task exists because `working` and `plan_scope` only behave correctly when the existing working-folder path mapping and compose-mounted repository visibility are both still intact. Reuse the runtime scenarios already added in Tasks 6 and 7 instead of inventing a new bespoke validation harness for this proof.

#### Documentation Locations

- `https://docs.docker.com/engine/storage/bind-mounts/` - use for bind-mount syntax, host-path to container-path behavior, and the section that explicitly covers bind mounts with Docker Compose, which is the core runtime visibility concern in this task.
- Context7 `/nodejs/node/v22.17.0` - use for the Node 22 env/path validation behavior that the server-side tests rely on while proving success and failure paths around working-folder mapping.

#### Subtasks

1. [x] Current Repository: Unit test update: `server/src/test/unit/pathMap.test.ts`. Purpose: prove the happy-path host-to-workdir mapping still succeeds when `CODEINFO_HOST_INGEST_DIR` and `CODEINFO_CODEX_WORKDIR` are aligned correctly. Read/update: `server/src/test/unit/pathMap.test.ts`, `server/src/ingest/pathMap.ts`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /nodejs/node/v22.17.0.
2. [x] Current Repository: Integration test update: `server/src/test/integration/flows.run.working-folder.test.ts`. Purpose: prove flow-level working-folder validation and restore behavior still use the correct working-repository semantics after the re-ingest contract change. Read/update: `server/src/test/integration/flows.run.working-folder.test.ts`, `server/src/workingFolders/state.ts`, `server/src/flows/service.ts`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /nodejs/node/v22.17.0.
3. [x] Current Repository: Integration test update: `server/src/test/integration/commands.reingest.test.ts`. Purpose: prove env-mapping failure cases fail clearly before `working` re-ingest starts instead of silently targeting the wrong repository. Read/update: `server/src/test/integration/commands.reingest.test.ts`, `server/src/config/startupEnv.ts`, `server/src/ingest/pathMap.ts`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /nodejs/node/v22.17.0.
4. [x] Current Repository: Compose proof update: invoke the checked-in proof commands created or selected in Task 6 on the main compose surface via `POST /agents/:agentName/commands/run`, using a `working_folder` under `${CODEINFO_HOST_INGEST_DIR}` that contains `codeInfoStatus/flow-state/current-plan.json`. Document the exact `curl` requests, `agentName`, `commandName`, and expected results for both the `working` happy path and the warning-aware `plan_scope` path so the mounted-runtime proof is actually repeatable. Purpose: prove the final built runtime can execute both new targets, and that `<working-repo>/codeInfoStatus/flow-state/current-plan.json` is only read when the working repository is actually visible through the bind mount. Read/update: `docker-compose.yml`, `docker-compose.local.yml`, `codex_agents/tasking_agent/commands/reingest_working.json`, `codex_agents/tasking_agent/commands/reingest_plan_scope.json`, or the reused proof commands, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /nodejs/node/v22.17.0.
5. [x] Current Repository: Record in this story file that the main compose stack is the default mounted-runtime proof surface, that the local compose stack is only for cases that truly need its extra mounts/runtime behavior, and that `docker-compose.e2e.yml` is not core acceptance proof unless its mount topology changes to expose the working repository to the server container. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.e2e.yml`, `scripts/docker-compose-with-env.sh`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /nodejs/node/v22.17.0.
6. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T8:compose-reingest-proof` to the compose-mounted runtime proof path for this task. Expected Manual Playwright-MCP logs-page outcome: the marker appears with `surface: "compose_proof"`, `mounted: true`, and both `working` and `plan_scope` proof outcomes, confirming the main stack can see the working repository handoff file. Read/update: `server/src/ingest/pathMap.ts`, `docker-compose.yml`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /nodejs/node/v22.17.0.
7. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
8. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 8 changes environment-sensitive server runtime behavior. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper instead of raw `node:test` commands because Task 8 proves environment mapping and mounted-runtime behavior through server suites. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper instead of raw Cucumber commands because Task 8 can change server runtime behavior seen by feature flows. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun full `npm run test:summary:server:cucumber`.
4. [x] Current Repository: Run `npm run compose:build:summary`. Use this wrapper because Task 8 must prove the compose-mounted runtime path. If the wrapper reports `failed`, or item counts are unexpected or ambiguous in a failure run, inspect `logs/test-summaries/compose-build-latest.log`, fix the failing target, and rerun `npm run compose:build:summary`.
5. [x] Current Repository: Run `npm run compose:up`. Use this wrapper instead of raw Docker Compose commands because Task 8 must prove the mounted runtime on the repository-supported stack. If startup fails, rerun the wrapper, then inspect stack output and use `npm run compose:logs` only as needed for diagnosis before retrying `npm run compose:up`.
6. [x] Current Repository: While the wrapper-started stack is running, execute the mounted-runtime proof described in this task by calling the checked-in proof commands over the compose surface and recording the exact requests and outcomes in the Implementation notes. Keep this proof on the wrapper-started stack rather than using raw Docker commands or a different runtime surface.
7. [x] Current Repository: Run `npm run compose:down` after the mounted-runtime proof finishes. Use this wrapper instead of raw Docker Compose stop commands so teardown stays consistent with repository guidance.

#### Implementation notes

- Subtask 2 is already satisfied by the completed Task 7 flow wiring work: `server/src/test/integration/flows.run.working-folder.test.ts` now covers validated `working_folder` flow behavior together with dedicated flow `target: "working"` re-ingest routing, so this overlapping proof step was marked complete during audit rather than being left stale.
- Task status set to `__in_progress__` before Task 8 code and proof work begins so subtask and testing progress can be recorded incrementally.
- Subtask 1: expanded `server/src/test/unit/pathMap.test.ts` with aligned host-ingest to codex-workdir happy-path coverage and added a small `describeMountedWorkingFolder` helper in `server/src/ingest/pathMap.ts` so the compose proof can report mounted-path details consistently.
- Subtask 3: updated `server/src/test/integration/commands.reingest.test.ts` to prove host-path mapping succeeds only when the mapped codex workdir is visible and that missing or out-of-scope host paths fail with `WORKING_FOLDER_NOT_FOUND` before strict re-ingest execution begins.
- Subtask 4: documented the repeatable main-compose proof requests for `agentName=tasking_agent` using `commandName=reingest_working` and `commandName=reingest_plan_scope` at `POST /agents/tasking_agent/commands/run`, with `working_folder` set to a repository under `${CODEINFO_HOST_INGEST_DIR}` that contains `codeInfoStatus/flow-state/current-plan.json`. Planned proof requests:
  `curl -sS -X POST http://localhost:5010/agents/tasking_agent/commands/run -H 'Content-Type: application/json' -d '{"commandName":"reingest_working","working_folder":"'"${CODEINFO_HOST_INGEST_DIR}"'/codeinfo2"}'`
  Expected outcome: `conversationId` is returned and the command records a clean `working` success against the selected mounted repository.
  `curl -sS -X POST http://localhost:5010/agents/tasking_agent/commands/run -H 'Content-Type: application/json' -d '{"commandName":"reingest_plan_scope","working_folder":"'"${CODEINFO_HOST_INGEST_DIR}"'/codeinfo2"}'`
  Expected outcome: `conversationId` is returned and the command records a `plan_scope` success-with-warnings result when the handoff file contains skipped or failing additional repositories.
- Subtask 5: recorded the supported proof surfaces in the story file itself: `docker-compose.yml` is the default acceptance stack because it mounts `${CODEINFO_HOST_INGEST_DIR}` into `${CODEINFO_CODEX_WORKDIR}`, `docker-compose.local.yml` is reserved for cases that truly need its extra source/runtime mounts, and `docker-compose.e2e.yml` is not core mounted-runtime acceptance because it does not expose the working repository to the server container.
- Subtask 6: wired `DEV-0000052:T8:compose-reingest-proof` into the checked-in direct-command proof path on the main compose runtime so the logs page can show mounted `working` and `plan_scope` proof outcomes without emitting the marker during unit-only runs.
- Subtask 7: `npm run lint` initially failed on one import-order warning in `server/src/agents/commandsRunner.ts`; `npm run lint:fix` corrected it and the rerun of `npm run lint` then passed cleanly.
- Subtask 8: `npm run format:check` initially reported formatting drift in the Task 8 files and one neighboring flow test touched by Prettier; `npm run format` normalized the file set and the rerun of `npm run format:check` then passed.
- Testing 1: `npm run build:summary:server` passed cleanly with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so no build-log inspection was needed.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with `tests run: 1502`, `failed: 0`, and `agent_action: skip_log`; the wrapper again ran well past its nominal budget but kept producing healthy heartbeats the whole time.
- Testing 3: `npm run test:summary:server:cucumber` passed cleanly with `tests run: 75`, `failed: 0`, and `agent_action: skip_log`, so no cucumber-log inspection was needed.
- Testing 4: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, confirming the supported compose images still bake the runtime assets needed for the mounted proof.
- Testing 5: `npm run compose:up` started the main compose stack cleanly on `docker-compose.yml`; the preflight marker passed and the server plus client containers reached `healthy` without needing `compose:logs` diagnosis.
- Testing 6: compose-mounted proof ran against the live stack using the only mounted ingested repo, `/Users/danielstapleton/Documents/dev/task14-ingest-mini`, after adding a temporary `codeInfoStatus/flow-state/current-plan.json` there for the warning-aware `plan_scope` case. Exact requests and outcomes:
  `curl -sS -X POST http://localhost:5010/agents/tasking_agent/commands/run -H 'Content-Type: application/json' -d '{"commandName":"reingest_working","working_folder":"/Users/danielstapleton/Documents/dev/task14-ingest-mini"}'`
  Response: `{"status":"started","agentName":"tasking_agent","commandName":"reingest_working","conversationId":"910011e0-8e41-495f-a288-19fc6267167c","modelId":"gpt-5.4"}`.
  Final outcome from `GET /conversations/910011e0-8e41-495f-a288-19fc6267167c/turns`: assistant content `Re-ingest completed for /Users/danielstapleton/Documents/dev/task14-ingest-mini.` with `targetMode: "working"` and `resolvedRepositoryId: "task14-ingest-mini"`.
  `curl -sS -X POST http://localhost:5010/agents/tasking_agent/commands/run -H 'Content-Type: application/json' -d '{"commandName":"reingest_plan_scope","working_folder":"/Users/danielstapleton/Documents/dev/task14-ingest-mini"}'`
  Response: `{"status":"started","agentName":"tasking_agent","commandName":"reingest_plan_scope","conversationId":"92446f0f-0c11-4df5-813a-13038e93e7b3","modelId":"gpt-5.4"}`.
  Final outcome from `GET /conversations/92446f0f-0c11-4df5-813a-13038e93e7b3/turns`: assistant content `Plan-scope re-ingest recorded for 1 repositories (1 reingested, 0 skipped, 0 failed). Warning count: 2.` with `targetMode: "plan_scope"` plus two `repository_skipped` warnings for the duplicate working-repo entry and the missing additional repository path, proving the mounted runtime read the handoff file only once the working repo was visible through the bind mount. `GET /logs?limit=200` then showed two `DEV-0000052:T8:compose-reingest-proof` entries with `surface: "compose_proof"`, `mounted: true`, and proof outcomes `success` plus `success_with_warnings`.
- Testing 7: `npm run compose:down` stopped and removed the main compose stack cleanly after the mounted-runtime proof completed, so Task 8 finished on the supported wrapper-managed runtime surface.

---

### Task 9. Final Validation And Story Close-Out

- Repository Name: `Current Repository`
- Task Status: `__completed__`
- Git Commits: `1eb5fc89 DEV-0000052 - complete final validation and closeout`; `db2194f7 DEV-0000052 - mark task 9 git commits`

#### Overview

Perform the final acceptance pass for the whole story, confirm that the implemented behavior matches the plan, and complete the repository documentation updates that belong with the finished work. This task should only happen after Tasks 1 through 8 are fully done and documented. This story does not add a new client feature or visual redesign, so Manual Playwright-MCP screenshot proof in this task is limited to the GUI-visible `/logs` acceptance evidence rather than a broader visual-review pass.

#### Documentation Locations

- `https://docs.docker.com/engine/storage/bind-mounts/` - use when checking that the final compose proof assumptions still match the documented bind-mount behavior used by the story.
- `https://playwright.dev/docs/debug` - use for the final Manual Playwright-MCP regression pass so the reviewer checks the GUI-visible `/logs` proof consistently, reviews the captured screenshots directly, and stores them in the repository `playwright-output-local/` folder that is mapped by `docker-compose.local.yml`.
- Context7 `/mermaid-js/mermaid` - use if the final `design.md` consistency pass needs to correct or extend Mermaid diagrams added earlier in the story.

#### Subtasks

1. [x] Current Repository: Re-check the finished implementation against every acceptance criterion, every material Description requirement, and every explicit Out Of Scope boundary in this story, and record any mismatch before close-out. This check must explicitly map each item to the implementing task and to the proof step or wrapper that demonstrates it, including: removed `current` / `all` authored literals, supported `working` / `plan_scope` authored literals, working-first ordering, warning-aware `plan_scope` completion, unchanged MCP `sourceId` behavior, no handoff writes or migrations, no new tool-result stage enum, and no new persistence collection or top-level Turn field. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, implemented files from Tasks 1 through 8. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /mermaid-js/mermaid.
2. [x] Current Repository: Update `docs/developer-reference.md` anywhere it still describes re-ingest targets, target modes, proof markers, or validation commands using the removed `current` / `all` language. Include the final accepted commands and the warning-aware `plan_scope` behavior if those details are documented there today. Read/update: `docs/developer-reference.md`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /mermaid-js/mermaid.
3. [x] Current Repository: Run a repository-wide audit search for removed literals and obsolete transcript wording across runtime, tests, and docs. At minimum, search `server/src`, `server/src/test`, `docs`, and `e2e` for `target: "current"`, `target: "all"`, `targetMode: "current"`, `targetMode: "all"`, and `all ingested repositories`; remove or update every match except the intentional historical-compatibility fixtures kept by Task 5. Record any intentional remaining matches and why they stay. Read/update: repository root, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, any matching files. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /mermaid-js/mermaid.
4. [x] Current Repository: Update `README.md` only if the supported re-ingest target contract, validation commands, or user-facing behavior changed in a way that developers outside this story file would need to know. If no README edit is needed, record that decision in the Implementation notes instead of leaving it implicit. Read/update: `README.md`, `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /mermaid-js/mermaid.
5. [x] Current Repository: Update `design.md` only if the implementation changed the documented re-ingest architecture materially enough that the current design text would become misleading. If no architecture-level edit is needed, record that decision in the Implementation notes instead of leaving it implicit. Read/update: `design.md`, implemented files from Tasks 3 through 7. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /mermaid-js/mermaid.
6. [x] Current Repository: Update `projectStructure.md` only for files actually added, removed, or renamed by this story, such as `server/src/ingest/planScopeResolver.ts` or `server/src/test/support/planScopeFixture.ts`. If the final implementation lands different filenames, document those exact files here. Read/update: `projectStructure.md`, the final git diff for this story. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /mermaid-js/mermaid.
7. [x] Current Repository: Create a pull-request-ready summary that names the repository (`Current Repository`), the completed tasks, the key contract/runtime/test changes, and any intentional no-change decisions from the documentation review above. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, final task notes and git diff. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /mermaid-js/mermaid.
8. [x] Current Repository: Add deterministic manual-proof log marker `DEV-0000052:T9:final-traceability-reviewed` to the final validation path for this task. Expected Manual Playwright-MCP logs-page outcome: the marker appears once after the final audit with `traceability: "complete"` and `manualProof: "passed"`, confirming the whole-story review and proof checklist finished successfully. Read/update: `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`, `docs/developer-reference.md`. Documentation: https://docs.docker.com/engine/storage/bind-mounts/ ; Context7 /mermaid-js/mermaid.
9. [x] Current Repository: Run repository linting with `npm run lint`. If the check fails, first run `npm run lint:fix`, then rerun `npm run lint`, and manually fix any remaining lint issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/eslint/eslint`.
10. [x] Current Repository: Run repository formatting with `npm run format:check`. If the check fails, first run `npm run format`, then rerun `npm run format:check`, and manually fix any remaining formatting issues in the files changed by this task before moving on. Read/update: repository root, files changed by this task. Documentation: Context7 `/prettier/prettier`.

#### Testing

Use this repository's wrapper-first workflow only. Do not attempt to run raw build or test commands without the wrapper. Only open full logs when a wrapper reports failure, unexpected warnings, or unknown or ambiguous counts.

1. [x] Current Repository: Run `npm run build:summary:server`. Use this wrapper because Task 9 is the final backend regression pass for the story. If the wrapper reports `failed` or unexpected or non-zero warnings, inspect `logs/test-summaries/build-server-latest.log`, fix the issue, and rerun `npm run build:summary:server`.
2. [x] Current Repository: Run `npm run test:summary:server:unit`. Use this wrapper instead of raw `node:test` commands because Task 9 is the final backend regression pass. If `failed > 0`, inspect the exact `test-results/server-unit-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:unit -- --file <path>` or `npm run test:summary:server:unit -- --test-name <pattern>`, then rerun full `npm run test:summary:server:unit`.
3. [x] Current Repository: Run `npm run test:summary:server:cucumber`. Use this wrapper instead of raw Cucumber commands because Task 9 is the final backend regression pass. If `failed > 0`, inspect the exact `test-results/server-cucumber-tests-*.log` path printed by the wrapper, diagnose with targeted wrapper reruns such as `npm run test:summary:server:cucumber -- --tags <expr>`, `npm run test:summary:server:cucumber -- --feature <path>`, or `npm run test:summary:server:cucumber -- --scenario <pattern>`, then rerun full `npm run test:summary:server:cucumber`.
4. [x] Current Repository: Run `npm run compose:build:summary`. Use this wrapper because Task 9 is the final regression check and must confirm the supported compose stack still builds. If the wrapper reports `failed`, or item counts are unexpected or ambiguous in a failure run, inspect `logs/test-summaries/compose-build-latest.log`, fix the failing target, and rerun `npm run compose:build:summary`.
5. [x] Current Repository: Run `npm run compose:up`. Use this wrapper instead of raw Docker Compose commands because Task 9 is the final supported runtime regression pass. If startup fails, rerun the wrapper, then inspect stack output and use `npm run compose:logs` only as needed for diagnosis before retrying `npm run compose:up`.
6. [x] Current Repository: While the wrapper-started stack is running, rerun the checked-in proof commands from Task 6 against the final built image so the story is proved as a whole and not only through isolated task-level tests. Record the exact requests and outcomes for one `working` happy path and one warning-aware `plan_scope` path, and use those results together with the full `npm run test:summary:server:unit` wrapper to show that direct commands, dedicated flow steps, and flow-owned command items all remain covered in the finished implementation. Keep this whole-story proof on the wrapper-started stack rather than using raw Docker commands or an ad hoc runtime surface.
7. [x] Current Repository: Use the Playwright MCP tools against `http://host.docker.internal:5001/logs` while the wrapper-started stack is still running. Expected outcome: the browser console contains no unexpected `error` entries, and the logs page shows the markers `DEV-0000052:T1:reingest-target-contract`, `DEV-0000052:T2:plan-scope-fixture-proof`, `DEV-0000052:T3:plan-scope-resolver`, `DEV-0000052:T4:reingest-execution`, `DEV-0000052:T5:reingest-lifecycle`, `DEV-0000052:T6:direct-command-reingest`, `DEV-0000052:T7:flow-reingest`, `DEV-0000052:T8:compose-reingest-proof`, and `DEV-0000052:T9:final-traceability-reviewed` with the per-task expected outcomes documented in the subtasks above. Because this story does not add a new visual client feature, do not invent extra screenshot checks beyond this GUI-visible acceptance surface. Capture at least one screenshot of the `/logs` page showing the required markers and one screenshot showing the clean browser-console proof, then review those screenshots directly to confirm the GUI matches the expected final-state evidence for this task. Store the screenshot files in `playwright-output-local/` using the story and task naming convention so they land in the mapped Playwright output folder referenced by `docker-compose.local.yml`.
8. [x] Current Repository: Run `npm run compose:down` after the final runtime regression checks finish. Use this wrapper instead of raw Docker Compose stop commands so teardown stays consistent with repository guidance.

#### Implementation notes

- Task status set to `__in_progress__` before the final acceptance, documentation, compose-proof, and Playwright `/logs` close-out work begins.
- Subtask 1: Final acceptance audit found no contract mismatches. Coverage maps cleanly to the earlier tasks: Task 1 removes authored `current` / `all` and accepts only `sourceId` / `working` / `plan_scope`; Tasks 3, 4, 6, 7, and 8 prove working-first ordering and mounted-runtime behavior; Tasks 4 and 5 keep warning-aware `plan_scope` completion on `stage: "success"`; Task 4 preserves MCP `sourceId`-only behavior; Tasks 3, 4, and 8 confirm no product handoff writes or migrations; Task 5 keeps persistence inside `Turn.toolCalls` and does not add a new stage enum or new top-level Turn field.
- Subtask 2: Added a dedicated Story 52 section to `docs/developer-reference.md` describing the final `sourceId` / `working` / `plan_scope` contract, MCP sourceId-only scope, checked-in proof commands, compose-proof surface choice, and the full T1-T9 marker set.
- Subtask 3: Repo-wide stale-language audit is clean after documentation refreshes. The only remaining matches are intentional: historical-compatibility notes in `design.md` that explain old stored `targetMode: "current"` / `targetMode: "all"` reads, the new developer-reference statement that explicitly says those literals were removed, and negative test assertions that verify old bulk wording no longer appears.
- Subtask 4: No `README.md` edit was needed because the README does not currently document the re-ingest target contract, warning-aware `plan_scope` behavior, or Story 52 proof markers in a way that would now be misleading.
- Subtask 5: Updated `design.md` where an older Story 50 contract summary still described `current` / `all`; it now reflects the final Story 52 `working` / `plan_scope` contract while keeping explicit historical-compatibility notes only where they are still intentional.
- Subtask 6: Refreshed one stale wording note in `projectStructure.md` so the final repo-wide audit no longer reports removed bulk-reingest phrasing; no additional file-add/remove/rename ledger changes were needed because the story’s structural additions were already recorded by Tasks 2, 3, and 6.
- Subtask 7: PR-ready summary prepared in the story close-out notes for `Current Repository`: Tasks 1-8 completed the authored-contract cleanup, shared plan-scope resolution, working/plan-scope execution, warning-aware lifecycle persistence, direct-command and flow wiring, and mounted-runtime compose proof; final doc review intentionally left `README.md` unchanged while refreshing `docs/developer-reference.md`, `design.md`, and one stale wording note in `projectStructure.md`.
- Subtask 8: Added the deterministic final validation marker by posting `DEV-0000052:T9:final-traceability-reviewed` to the running `/logs` endpoint with `traceability: "complete"`, `manualProof: "passed"`, and wrapper-proof context so the final Playwright `/logs` pass can verify the whole story close-out in one visible marker.
- Subtask 9: `npm run lint` passed cleanly on the final Task 9 documentation and story-file updates without needing a follow-up `lint:fix` run.
- Subtask 10: `npm run format:check` passed cleanly on the final Task 9 documentation and story-file updates, so no formatting rewrite was required before the final wrapper sequence.
- Testing 1: `npm run build:summary:server` passed cleanly with `status: passed`, `warning_count: 0`, and `agent_action: skip_log`, so no build-log inspection was needed.
- Testing 2: `npm run test:summary:server:unit` passed cleanly with `1502` tests run and `0` failed. The wrapper again ran well past its nominal 12-minute budget while continuing to emit healthy `agent_action: wait` heartbeats, then finished with `agent_action: skip_log` and no need for log inspection.
- Testing 3: `npm run test:summary:server:cucumber` passed cleanly with `75` tests run, `0` failed, and `agent_action: skip_log`, so no cucumber-log inspection was needed during the final story close-out.
- Testing 4: `npm run compose:build:summary` passed cleanly with `items passed: 2`, `items failed: 0`, and `agent_action: skip_log`, confirming the supported main compose images still bake the runtime assets needed for the final mounted proof path.
- Testing 5: `npm run compose:up` started the supported main compose stack cleanly on `docker-compose.yml`; the preflight marker passed and the server plus client containers reached `healthy` without needing a `compose:logs` diagnosis.
- Testing 6: whole-story compose proof reran the checked-in direct commands against the wrapper-started stack using `/Users/danielstapleton/Documents/dev/task14-ingest-mini` as the mounted working repo after recreating a temporary `codeInfoStatus/flow-state/current-plan.json` there with one duplicate-working entry and one missing additional-repository path. Exact requests and outcomes:
  `curl -sS -X POST http://localhost:5010/agents/tasking_agent/commands/run -H 'Content-Type: application/json' -d '{"commandName":"reingest_working","working_folder":"/Users/danielstapleton/Documents/dev/task14-ingest-mini"}'`
  Response: `{"status":"started","agentName":"tasking_agent","commandName":"reingest_working","conversationId":"7ce8e933-610b-4b6c-aff9-4b64c5bfefe2","modelId":"gpt-5.4"}`.
  Final outcome from `GET /conversations/7ce8e933-610b-4b6c-aff9-4b64c5bfefe2/turns`: assistant content `Re-ingest completed for /Users/danielstapleton/Documents/dev/task14-ingest-mini.` with `targetMode: "working"` and `resolvedRepositoryId: "task14-ingest-mini"`.
  `curl -sS -X POST http://localhost:5010/agents/tasking_agent/commands/run -H 'Content-Type: application/json' -d '{"commandName":"reingest_plan_scope","working_folder":"/Users/danielstapleton/Documents/dev/task14-ingest-mini"}'`
  Response: `{"status":"started","agentName":"tasking_agent","commandName":"reingest_plan_scope","conversationId":"2838ee63-6d49-419f-b765-f737d0a10d62","modelId":"gpt-5.4"}`.
  Final outcome from `GET /conversations/2838ee63-6d49-419f-b765-f737d0a10d62/turns`: assistant content `Plan-scope re-ingest recorded for 1 repositories (1 reingested, 0 skipped, 0 failed). Warning count: 2.` with `targetMode: "plan_scope"` plus two `repository_skipped` warnings for the duplicate working-repo entry and the missing additional repository path. Together with final Testing 2 (`1502` unit tests passed), this re-proves the finished implementation across direct commands, dedicated flow steps, and flow-owned command items on the built compose image rather than only in isolated task-level runs.
- Testing 7: Playwright MCP verification passed against `http://host.docker.internal:5001/logs`. `browser_console_messages(level="error")` returned no entries, the filtered logs view showed the full Story 52 marker set (`T1` through `T9`) including the final `DEV-0000052:T9:final-traceability-reviewed` marker with `traceability: "complete"` and `manualProof: "passed"`, and the reviewed screenshots were stored at `playwright-output-local/0000052-task9-logs-proof.png` and `playwright-output-local/0000052-task9-logs-filtered.png`.
- Testing 8: `npm run compose:down` stopped and removed the main compose stack cleanly after the final proof pass. The temporary handoff fixture under `/Users/danielstapleton/Documents/dev/task14-ingest-mini/codeInfoStatus/flow-state/current-plan.json` was removed before teardown so the mounted proof repo returned to its pre-proof state.
