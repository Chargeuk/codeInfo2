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

Duplicate repositories should be removed while preserving the first occurrence. If the current working repository is also listed in `additional_repositories`, that duplicate should be ignored. If the same additional repository appears more than once, only the first occurrence should be kept.

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

### Result and warning contract

- `working` remains a single-repository re-ingest and should continue to use the same single-repository result shape that the product already uses for explicit selector-based re-ingest.
- `plan_scope` must reuse the existing multi-repository batch result shape rather than inventing a new one. At minimum, the runtime must continue to populate:
  - `targetMode`, now allowing the literal `"plan_scope"`;
  - `repositories`, ordered exactly as attempted;
  - `summary`, with counts derived only from attempted repositories.
- Each attempted repository entry in the batch result must represent one repository that actually started re-ingest and must include that repository's terminal outcome.
- Skipped-at-resolution repositories must not be synthesized into the `repositories` array. They belong in warnings, structured logs, or step metadata instead.
- When `plan_scope` falls back to the working repository only because the handoff file is missing, malformed, unreadable, or empty, the batch still succeeds if that working-repository re-ingest succeeds. The warning should explain why no additional repositories were attempted.
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
  - missing file, unreadable file, malformed JSON, or empty `additional_repositories` must fall back to working-only behavior plus warnings;
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
- Missing prerequisite capabilities:
  - Task 3's resolver and Task 2's fixture support must exist first so Task 4 can consume them instead of rebuilding plan-scope resolution inline.
- Assumptions that are currently invalid:
  - It is not valid to assume every run has a usable working repository. Task 4 must treat missing or unresolved `working_folder` context as a clear pre-start failure for `working`.

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
- Assumptions that are currently invalid:
  - It is not valid to assume direct-command tests already assert the new target-mode values or warning behavior. Task 6 must update those expectations explicitly.

### Task 7. Wire Flow Re-Ingest Surfaces To The New Runtime Contract

- Already existing capabilities:
  - `server/src/agents/commandItemExecutor.ts`, `server/src/flows/service.ts`, and the flow integration suites already provide the flow surfaces this task needs to update in place.
- Missing prerequisite capabilities:
  - Tasks 4 and 5 must complete first so Task 7 can wire top-level flow steps and flow-owned command items to the new execution and payload contracts.
- Assumptions that are currently invalid:
  - It is not valid to assume existing flow tests already assert the new pre-start wording or target-mode values. Task 7 must update those expectations explicitly.

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

- **A `plan_scope` request would otherwise produce zero attempted repositories after resolution.**
  - This should only be possible if the working repository failed pre-start validation, because the working repository is always intended to be first.
  - The story should therefore treat zero-attempt `plan_scope` execution as a failure to start, not as a successful empty batch.

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
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Replace the command and flow authoring contract so newly-authored re-ingest items use `sourceId`, `working`, or `plan_scope`, and the removed `current` / `all` literals fail schema validation. This task is only about parser- and type-level contract replacement, so it can be proved with focused schema tests before runtime execution changes are attempted.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `planning/plan_format.md`
- `server/src/agents/commandsSchema.ts`
- `server/src/flows/flowSchema.ts`
- `server/src/test/unit/agent-commands-schema.test.ts`
- `server/src/test/unit/flows-schema.test.ts`
- Context7 `/colinhacks/zod`

#### Subtasks

1. [ ] Update `server/src/agents/commandsSchema.ts` so re-ingest command items accept only `{ sourceId }`, `target: "working"`, or `target: "plan_scope"`, and remove the `current` / `all` branches from both the schema and inferred TypeScript types.
2. [ ] Update `server/src/flows/flowSchema.ts` so re-ingest flow steps accept only `{ sourceId }`, `target: "working"`, or `target: "plan_scope"`, and remove the `current` / `all` branches from both the schema and exported TypeScript types.
3. [ ] Update `server/src/test/unit/agent-commands-schema.test.ts` and `server/src/test/unit/flows-schema.test.ts` so they prove accepted shapes, rejected removed literals, rejection of mixed `sourceId` + `target`, and rejection of unexpected extra keys.
4. [ ] Search the repository for checked-in command and flow JSON assets that still contain `target: "current"` or `target: "all"`, update real assets if found, and record in the task notes if the search proves no checked-in assets required migration.
5. [ ] Update this story file if implementation reveals any authored-contract detail that differs from the planned command or flow shape.
6. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Prove the schema contract with `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-schema.test.ts --file server/src/test/unit/flows-schema.test.ts`.

#### Implementation notes

- No implementation notes yet.

---

### Task 2. Add The Shared Plan-Scope Fixture Harness

- Repository Name: `Current Repository`
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Create the shared filesystem fixture helper that later plan-scope tasks will depend on. This task should stay focused on reusable temp-repository setup and cleanup so the resolver and execution tasks can consume a stable harness instead of hand-rolling their own file trees.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `server/src/test/support`
- `server/src/test/unit/pathMap.test.ts`
- `server/src/test/unit/agent-commands-runner.test.ts`
- `server/src/test/unit/planScopeFixture.test.ts`
- `codeInfoStatus/flow-state/current-plan.json`

#### Subtasks

1. [ ] Create `server/src/test/support/planScopeFixture.ts` so tests can build working repositories, handoff files, duplicate entries, malformed files, and invalid repository-path scenarios without repeating ad hoc filesystem setup.
2. [ ] Keep `planScopeFixture` focused on reusable temp-repository creation and cleanup only; it must not perform repository selection, re-ingest execution, or warning shaping itself.
3. [ ] Follow the temporary-directory and cleanup patterns already used in `server/src/test/unit/agent-commands-runner.test.ts` and `server/src/test/unit/pathMap.test.ts`, including `fs.mkdtemp`, minimal directory creation, and explicit `fs.rm(..., { recursive: true, force: true })` teardown.
4. [ ] Create `server/src/test/unit/planScopeFixture.test.ts` and prove the fixture helper can create the expected temporary working-repository layout, write handoff variants, and clean up without uncaught filesystem errors.
5. [ ] Update this story file if implementation uncovers a better fixture boundary than the one currently documented.
6. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Prove the fixture harness behavior with `npm run test:summary:server:unit -- --file server/src/test/unit/planScopeFixture.test.ts`.

#### Implementation notes

- No implementation notes yet.

---

### Task 3. Add The Plan-Scope Resolution Helper

- Repository Name: `Current Repository`
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Create the plan-scope resolution helper that reads the handoff file and turns it into ordered repository scope plus warnings. This task should stop at the resolution boundary so the later execution task can consume one clear helper instead of mixing file parsing, selector lookup, and re-ingest execution together.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `server/src/ingest/reingestExecution.ts`
- `server/src/ingest/pathMap.ts`
- `server/src/mcpCommon/repositorySelector.ts`
- `server/src/workingFolders/state.ts`
- `server/src/test/unit/pathMap.test.ts`
- `server/src/test/unit/planScopeResolver.test.ts`
- `server/src/test/support/planScopeFixture.ts`
- `codeInfoStatus/flow-state/current-plan.json`

#### Subtasks

1. [ ] Create `server/src/ingest/planScopeResolver.ts` to read `<working-repo>/codeInfoStatus/flow-state/current-plan.json`, normalize `additional_repositories[].path`, preserve working-repo-first order, remove duplicates, and return structured warning data for missing, malformed, unreadable, or unusable handoff entries.
2. [ ] Keep `planScopeResolver` focused on resolution only: it must not run re-ingest itself, must not rewrite the handoff file, and must resolve additional repository entries through the existing repository-selector path and existing path-normalization helpers instead of inventing a second direct filesystem-based selector for non-working repositories.
3. [ ] Create `server/src/test/unit/planScopeResolver.test.ts` and prove missing-file fallback, malformed-file warnings, de-duplication, and normalization behavior using `server/src/test/support/planScopeFixture.ts` before execution wiring depends on the helper.
4. [ ] Update this story file if implementation uncovers a better helper boundary or warning shape than the one currently documented.
5. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Prove the resolution helper with `npm run test:summary:server:unit -- --file server/src/test/unit/planScopeResolver.test.ts`.

#### Implementation notes

- No implementation notes yet.

---

### Task 4. Implement Working And Plan-Scope Execution

- Repository Name: `Current Repository`
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Implement the actual runtime execution contract for `working` and `plan_scope` inside the re-ingest layer. This task should stop at the execution result boundary: it should not yet change the persisted chat/lifecycle message contract.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `server/src/ingest/reingestExecution.ts`
- `server/src/ingest/reingestError.ts`
- `server/src/ingest/pathMap.ts`
- `server/src/mcpCommon/repositorySelector.ts`
- `server/src/workingFolders/state.ts`
- `server/src/test/unit/reingestExecution.test.ts`
- `server/src/test/support/planScopeFixture.ts`
- `server/src/ingest/planScopeResolver.ts`

#### Subtasks

1. [ ] Update `server/src/ingest/reingestExecution.ts` in place so `ReingestRequest`, `ReingestTargetMode`, `ReingestExecutionSingleResult`, and `ReingestExecutionBatchResult` match the new `working` / `plan_scope` contract defined in this story rather than adding a parallel executor.
2. [ ] Replace the owner-based `current` single-repository branch with a working-repository branch that resolves the already-selected run `working_folder`, reuses the existing working-folder/path-mapping logic, fails before start when no valid working repository can be resolved, and fails clearly when that repository is not currently ingested.
3. [ ] Replace the old `all` branch with a `plan_scope` batch branch that uses `planScopeResolver`, attempts only resolved repositories, keeps working-repo-first order, continues after per-repository failures, and returns the planned `warnings` array.
4. [ ] Remove or rename the obsolete `current` / `all` execution helpers and error branches inside `server/src/ingest/reingestExecution.ts` as part of the change so the removed literals do not survive in runtime types, helper names, or dead fallback code.
5. [ ] Update the execution-layer structured logging so `working`, `plan_scope`, plan-scope fallback-to-working-only, skipped-at-resolution repositories, and continued-after-failure batches are all distinguishable in logs and step metadata instead of being reported like the removed `current` / `all` modes.
6. [ ] Preserve explicit `sourceId` behavior and keep MCP-oriented selector semantics unchanged inside the execution layer.
7. [ ] Update `server/src/test/unit/reingestExecution.test.ts` so it proves `working`, `plan_scope`, de-duplication, missing/malformed handoff fallback, invalid additional repositories, zero-attempt prevention behavior, and any warning/log metadata assertions needed to keep the execution contract inspectable.
8. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Prove the execution contract with `npm run test:summary:server:unit -- --file server/src/test/unit/reingestExecution.test.ts`.

#### Implementation notes

- No implementation notes yet.

---

### Task 5. Implement The Re-Ingest Message And Persistence Contract

- Repository Name: `Current Repository`
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Update the server-side tool-result and lifecycle message contract so completed `plan_scope` batches can be published and persisted as success-with-warnings without breaking historical payload reads. This task is intentionally separate from the execution task because the message/persistence contract is its own testable server output.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `server/src/chat/interfaces/ChatInterface.ts`
- `server/src/chat/reingestToolResult.ts`
- `server/src/chat/reingestStepLifecycle.ts`
- `server/src/mongo/turn.ts`
- `server/src/test/unit/reingest-tool-result.test.ts`
- `server/src/test/unit/reingest-step-lifecycle.test.ts`

#### Subtasks

1. [ ] Update `server/src/chat/reingestToolResult.ts` so single re-ingest payloads use `targetMode: "sourceId" | "working"` and batch payloads use `targetMode: "plan_scope"` plus the explicit `warnings` array.
2. [ ] Keep `ChatToolResultEvent.stage` on the existing `success` / `error` enum and represent success-with-warnings as `stage: "success"` plus batch warnings, rather than inventing a third stage.
3. [ ] Update `server/src/chat/reingestStepLifecycle.ts` so it accepts, persists, and publishes the new batch payload shape while preserving readability of historical stored payloads that still contain `current` or `all`.
4. [ ] Update the lifecycle-generated user/assistant turn text so `plan_scope` results are no longer described as applying to "all ingested repositories" and warning-style completion is visible to transcript readers without being turned into a hard error.
5. [ ] Confirm that `server/src/mongo/turn.ts` does not require a new top-level field or collection because the new payload continues to live inside `Turn.toolCalls`, and keep persistence on the existing fresh `appendTurn` write path rather than introducing an in-place `markModified('toolCalls')` mutation flow for `Schema.Types.Mixed`.
6. [ ] Update `server/src/test/unit/reingest-tool-result.test.ts` and `server/src/test/unit/reingest-step-lifecycle.test.ts` so they prove warning-style completion, warning persistence, transcript-facing warning text, and historical payload compatibility.
7. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Prove the message and persistence contract with `npm run test:summary:server:unit -- --file server/src/test/unit/reingest-tool-result.test.ts --file server/src/test/unit/reingest-step-lifecycle.test.ts`.

#### Implementation notes

- No implementation notes yet.

---

### Task 6. Wire Direct Commands To The New Runtime Contract

- Repository Name: `Current Repository`
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the new schema, execution, and message contracts into direct command execution only. This task should prove the end-to-end behavior for direct command re-ingest before the story moves on to top-level flow steps and flow-owned command items.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `server/src/agents/commandsRunner.ts`
- `server/src/agents/service.ts`
- `server/src/test/unit/agent-commands-runner.test.ts`
- `server/src/test/integration/commands.reingest.test.ts`

#### Subtasks

1. [ ] Update `server/src/agents/commandsRunner.ts` so direct commands pass the working repository path into `executeReingestRequest` and preserve the new target-mode logging.
2. [ ] Update `server/src/test/unit/agent-commands-runner.test.ts` so direct-command logging, lifecycle, and batch-result expectations no longer assume `targetMode: "all"` or the removed `current` target wording.
3. [ ] Update integration coverage in `server/src/test/integration/commands.reingest.test.ts` for direct-command `working` and `plan_scope` behavior, including fallback and warning cases.
4. [ ] Update this story file if direct-command wiring reveals any behavior difference that the plan currently describes incorrectly.
5. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Prove the direct-command runtime surface with `npm run test:summary:server:unit -- --file server/src/test/unit/agent-commands-runner.test.ts --file server/src/test/integration/commands.reingest.test.ts`.

#### Implementation notes

- No implementation notes yet.

---

### Task 7. Wire Flow Re-Ingest Surfaces To The New Runtime Contract

- Repository Name: `Current Repository`
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Wire the new contract into top-level flow re-ingest steps and flow-owned command items. This task should prove that the flow runtime uses the same `working` and `plan_scope` behavior as direct commands without keeping any owner-based compatibility fallback.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `server/src/agents/commandItemExecutor.ts`
- `server/src/flows/service.ts`
- `server/src/test/integration/flows.run.command.test.ts`
- `server/src/test/integration/flows.run.errors.test.ts`
- `server/src/test/integration/flows.run.working-folder.test.ts`

#### Subtasks

1. [ ] Update `server/src/agents/commandItemExecutor.ts` and `server/src/flows/service.ts` so flow-owned command items and top-level flow re-ingest steps pass the working repository path into `executeReingestRequest` and preserve the new target-mode logging.
2. [ ] Update integration coverage in `server/src/test/integration/flows.run.command.test.ts` so top-level flow steps and flow-owned command items prove the same runtime behavior as the direct-command surface.
3. [ ] Update integration coverage in `server/src/test/integration/flows.run.errors.test.ts` and any affected working-folder integration tests so flow pre-start failures use the new target wording and working-repository semantics where applicable.
4. [ ] Update this story file if flow wiring reveals any cross-surface behavior difference that the plan currently describes incorrectly.
5. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Prove the flow runtime surfaces with `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts --file server/src/test/integration/flows.run.errors.test.ts --file server/src/test/integration/flows.run.working-folder.test.ts`.

#### Implementation notes

- No implementation notes yet.

---

### Task 8. Validate Working-Folder Environment And Mounted Runtime Access

- Repository Name: `Current Repository`
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Prove the environment-sensitive and container-visible runtime assumptions that this story depends on. This task exists because `working` and `plan_scope` only behave correctly when the existing working-folder path mapping and compose-mounted repository visibility are both still intact. Reuse the runtime scenarios already added in Tasks 6 and 7 instead of inventing a new bespoke validation harness for this proof.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `server/src/config/startupEnv.ts`
- `server/src/ingest/pathMap.ts`
- `server/src/routes/ingestDirs.ts`
- `server/src/workingFolders/state.ts`
- `server/.env`
- `docker-compose.yml`
- `docker-compose.local.yml`
- `docker-compose.e2e.yml`
- `scripts/docker-compose-with-env.sh`
- `package.json`
- `server/src/test/unit/pathMap.test.ts`
- `server/src/test/integration/flows.run.working-folder.test.ts`
- `server/src/test/integration/commands.reingest.test.ts`
- `server/src/test/integration/flows.run.command.test.ts`

#### Subtasks

1. [ ] Update the existing working-folder or re-ingest integration coverage so it explicitly proves the story behavior when `CODEINFO_HOST_INGEST_DIR` and `CODEINFO_CODEX_WORKDIR` are present and correctly aligned with the selected working repository path, reusing the existing `mapHostWorkingFolderToWorkdir` contract instead of introducing new environment-path translation logic.
2. [ ] Add or update targeted server-side coverage for the failure path where the working-folder env mapping is missing or inconsistent, and prove that `working` fails clearly before start instead of silently targeting the wrong repository.
3. [ ] Add or update targeted proof for `plan_scope` on the supported compose proof surface by reusing one of the direct-command or flow scenarios already added in Tasks 6 or 7, so the runtime reads `<working-repo>/codeInfoStatus/flow-state/current-plan.json` only when that working repository is actually visible inside the server container through the existing bind mount.
4. [ ] Record in this story file that the main compose stack is the default proof surface for mounted working-repository visibility, and only use the local compose stack when a story-specific validation really needs its extra mounts or runtime behavior. Also note explicitly that the e2e stack is not core acceptance proof unless its mount topology is changed to expose the working repository to the server container.
5. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Prove the env-sensitive runtime behavior with `npm run test:summary:server:unit -- --file server/src/test/unit/pathMap.test.ts --file server/src/test/integration/commands.reingest.test.ts --file server/src/test/integration/flows.run.command.test.ts --file server/src/test/integration/flows.run.working-folder.test.ts`.
6. [ ] After `npm run compose:up`, rerun one of the story's existing direct-command or flow `plan_scope` scenarios against the main compose surface and record the exact command or request in the implementation notes so a later developer can repeat the same mounted-repository proof without rediscovering it.

#### Implementation notes

- No implementation notes yet.

---

### Task 9. Final Validation And Story Close-Out

- Repository Name: `Current Repository`
- Task Status: `__to_do__`
- Git Commits: `__to_do__`

#### Overview

Perform the final acceptance pass for the whole story, confirm that the implemented behavior matches the plan, and complete the repository documentation updates that belong with the finished work. This task should only happen after Tasks 1 through 8 are fully done and documented.

#### Documentation Locations

- `planning/0000052-users-can-reingest-the-working-repository-or-plan-scope.md`
- `README.md`
- `design.md`
- `docs/developer-reference.md`
- `projectStructure.md`

#### Subtasks

1. [ ] Re-check the finished implementation against every acceptance criterion in this story and record any mismatch before attempting close-out.
2. [ ] Update `docs/developer-reference.md` anywhere it still describes re-ingest targets, target modes, proof markers, or validation commands using the removed `current` / `all` language.
3. [ ] Update `README.md` only if the supported re-ingest target contract, validation commands, or user-facing behavior changed in a way that should be documented for developers outside the story file.
4. [ ] Update `design.md` only if the implementation changed the documented re-ingest architecture materially enough that the existing design text would become misleading.
5. [ ] Update `projectStructure.md` only for files that were actually added, removed, or renamed by this story, such as `server/src/ingest/planScopeResolver.ts` or `server/src/test/support/planScopeFixture.ts`.
6. [ ] Create a pull-request-ready summary covering all tasks completed in this story and the major contract/runtime/test changes that landed.
7. [ ] Run full linting with `npm run lint`.

#### Testing

1. [ ] Prove the server build works outside Docker with `npm run build:summary:server`.
2. [ ] Prove the client build works outside Docker with `npm run build:summary:client`.
3. [ ] Prove the Docker build wrapper still succeeds with `npm run compose:build:summary`.
4. [ ] Prove Docker Compose starts with `npm run compose:up` and can be stopped with `npm run compose:down`.
5. [ ] Run the full server validation wrapper with `npm run test:summary:server:unit`.
6. [ ] Run `npm run test:summary:e2e` only if the environment has been explicitly made suitable for proving the required filesystem visibility; otherwise record in the implementation notes that e2e remained optional regression smoke and was not used as core acceptance proof for this story.
7. [ ] If an appropriate browser-visible surface exists by this point, use the Playwright MCP tool to perform a manual regression check and save any required screenshots to `./test-results/screenshots/` using the story/task naming convention; otherwise record why no UI-specific proof was applicable to this server-only story.

#### Implementation notes

- No implementation notes yet.
