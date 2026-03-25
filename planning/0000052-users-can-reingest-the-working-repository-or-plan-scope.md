# Story 0000052 – Users can reingest the working repository or plan scope

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

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
- Unsupported target values, including removed `current`, must fail during normal schema or validation handling before any re-ingest run starts. This story should not add a compatibility-only branch that rewrites old target values at runtime.

### Developer-facing implementation boundary

- The same target semantics must be implemented in exactly three places and kept aligned:
  - direct command re-ingest items;
  - dedicated flow re-ingest steps;
  - re-ingest items inside commands executed by flows.
- MCP `reingest_repository` is explicitly outside this contract change. It should stay selector-driven and should not gain `working` or `plan_scope` parsing, fallback, or plan-handoff behavior.
- Checked-in workflow assets in this repository are part of the story output. If a checked-in command or flow still uses `target: "current"`, updating that asset is part of completing the story, not optional cleanup.

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
- When a `plan_scope` batch starts successfully and completes its full ordered pass, the overall tool result is reported as success-with-warnings rather than as a hard error, even if some repositories in the batch failed.
- `target: "plan_scope"` records one structured batch result payload covering all repositories it attempted, rather than emitting unrelated single-repository transcript items.
- `target: "plan_scope"` reuses the existing batch transcript payload shape used by multi-repository re-ingest, rather than introducing a second plan-scope-only batch payload.
- The batch result for `target: "plan_scope"` contains the ordered list of repositories attempted and the terminal outcome for each repository.
- The batch result for `target: "plan_scope"` also contains summary counts so the UI and tests can assert the batch outcome directly.
- Additional repositories that are skipped before re-ingest begins because they are invalid or not currently ingested do not appear in the batch `repositories` array or summary counts.
- Logs and structured runtime metadata clearly distinguish `sourceId`, `working`, and `plan_scope` target modes.
- Logs also make it clear when `plan_scope` had to fall back to the working repository only, skip unusable additional repositories, or continue after repository-level failures.
- Warning text, structured logs, and step metadata make skipped-at-resolution repositories visible even though they are not part of the attempted-repository batch payload.
- Warning-oriented assistant text and UI status make it clear when `plan_scope` completed with some repository failures, without treating the whole batch as a hard error.
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
    - `npm run test:summary:e2e` only after deciding whether the e2e stack is actually an appropriate proof surface for the filesystem visibility required by the scenario being tested.

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

## Questions

- No Further Questions
