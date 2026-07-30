# Story 0000065 – Users can run configurable local Copilot reviews alongside first and repeated review passes

## Implementation Plan

This story follows the repository task contract in `planning/plan_format.md`. It documents the complete local GitHub Copilot CLI review feature carried by this branch: resilient model configuration, repository-by-model scheduling in the existing first and repeated review wave, isolated child workspaces, native and explicitly selected external endpoints, secure local `/review` execution, independent artifacts and usage, best-effort recovery, and exclusion of changed planning files.

### Description

Before this story, first and repeated review batches scheduled the existing review providers but could not add local GitHub Copilot CLI `/review` jobs. Operators could not select several native or external Copilot models and have each model independently review every repository target without manually creating separate flows. Adding a separate Copilot wave would also have weakened the existing concurrency, cancellation, resume, workspace, and reconciliation contracts.

After this story, `CODEINFO_COPILOT_REVIEW_MODELS` can configure zero or more local Copilot review models. Each valid model becomes one matrix group over the complete immutable repository target list, so `R` repositories and `M` configured models create exactly `R × M` Copilot children. In the first pass and any repeated pass of the generic review group, these groups join the same `subflowWave` as the existing per-repository reviews; existing groups remain unchanged, all viable children are admitted without waiting for earlier children to finish, and the parent waits for collective settlement. The later one-shot `review_artifacts_main` batch explicitly disables Copilot additions so this feature does not duplicate that separate review stage.

The configuration grammar is `[<external-endpoint-label>::]<exact-model-id>|<reasoning-effort>`, with comma-separated entries. Native selectors use the Copilot model ID directly. External selectors require the normalized label of an entry in `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS`; a matching model name on an unqualified or different endpoint is never selected. Model IDs preserve provider case, and supported efforts are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

Configuration is handled entry by entry in keeping with the repository's best-effort flow policy. Blank configuration preserves the pre-change review groups exactly. Malformed entries are discarded with visible secret-free warnings, duplicate endpoint/model selectors use deterministic first-valid-entry-wins behavior, and every remaining valid unambiguous model is scheduled. If no valid entries remain, the non-Copilot reviews still run. Valid but unavailable models remain represented so every repository receives an honest terminal unavailable result rather than silently losing coverage.

Native models reuse local Copilot CLI readiness, model discovery, and normal authentication. External models resolve only through their explicit endpoint label, require OpenAI-compatible completions support and exact runtime model discovery, and carry a normalized endpoint identity snapshot into the child workspace. Immediately before launch, the launcher verifies that the same label still resolves to the same endpoint identity and model. Endpoint reassignment or runtime drift makes only that review unavailable without resolving the replacement credential or stopping sibling jobs.

Every Copilot child receives immutable pinned target, base, head, wave, model, endpoint, reasoning, availability, and job identity data in a private review workspace. The local launcher validates the repository and commits before contacting a provider, invokes Copilot exactly once with non-interactive JSONL `/review`, closes stdin, and passes `--allow-all` because CodeInfo's Docker container is the isolation boundary, matching the existing Codex and OpenCode review policy. Full access does not weaken the provider or remote-session boundaries: built-in GitHub MCP access, remote control, and remote export remain disabled, provider credentials remain isolated from tool environments, and persisted artifacts remain confined to the assigned workspace. Native launches remove inherited BYOK variables; external launches receive only the selected endpoint and key in their child-process environment. Credentials and broad key maps never enter command arguments, flow state, resume state, metadata, output, or logs.

The Copilot child flow launches through a native service step rather than an LLM wrapper. That step cross-checks the persisted child payload against the immutable wave target, pinned model snapshot, and canonical private workspace; generates the review instructions deterministically from the pinned target and story context; and directly awaits the reusable launcher with the flow cancellation signal. No agent copies absolute paths or semantic arguments into a shell command, and no orchestration cell or tool-session handle sits between the flow lifecycle and the Copilot process.

The launcher preserves secret-free invocation metadata, raw JSONL, raw stderr, numeric exit status, timestamps, inner Copilot usage, and a normalized review result in the assigned workspace. Successful, partial, failed, timed-out, cancelled, drifted, and unavailable outcomes retain whatever trustworthy evidence exists. One child failure does not stop independent reviews. Resume reattaches through stable instance and input identities without duplicating children, and cancellation follows the existing wave semantics.

Copilot is explicitly instructed not to inspect, read, summarize, cite, or report findings for changes under repository-root-relative `planning/**`. Its Git diff guidance uses the exact pinned `base...head` range with `-- . ':(exclude)planning/**'`, while the compact prepared story context remains the authoritative requirements source. This is an instruction and Git pathspec boundary, not a synthetic commit or hard filesystem sandbox.

Each Copilot review remains independently discoverable with its model-specific status, output, diagnostics, endpoint identity, and usage. Existing generic verification and reconciliation discover all completed child artifacts without assuming a fixed provider count, preserve per-job provenance, and merge supported findings into the normal batch reconciliation.

Automated proof for this story must run with test-runner concurrency set to one. The relevant flow integration suite mutates process-wide `FLOWS_DIR`, `CODEINFO_COPILOT_REVIEW_MODELS`, and `CODEINFO_COPILOT_CLI_PATH` values and uses shared in-memory conversation and turn stores that its setup and cleanup hooks clear. That harness has not been designed or validated for concurrent test execution, so worker- or thread-level parallelism cannot provide trustworthy proof without separate test-isolation work. This restriction applies only to the test runner: controlled sequential tests deliberately hold child fakes open and prove that the application still admits all existing and Copilot children concurrently into one wave.

### Acceptance Criteria

- Missing, unset, or whitespace-only `CODEINFO_COPILOT_REVIEW_MODELS` produces exactly the pre-change review-group structure and launches no Copilot children.
- The accepted entry grammar is `[<external-endpoint-label>::]<exact-model-id>|<reasoning-effort>`, with comma-separated entries and supported effort values `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Surrounding whitespace is trimmed, exact model-ID case is preserved, and comma, pipe, and `::` retain their documented delimiter meanings.
- Native entries select exact Copilot-advertised model IDs without inheriting external provider selection.
- External entries require an explicit normalized endpoint label and exact provider model key; model-name coincidence never selects an endpoint.
- The tracked server environment configures built-in `kimi-k2.7-code|none` and `claude-sonnet-5|medium`; the operator-local configuration can additionally select `openrouter::deepseek/deepseek-v4-flash|none` and `openrouter::qwen/qwen3.7-flash|none`.
- Configuration entries are validated independently. Every valid unambiguous entry survives malformed siblings, and every discarded malformed entry emits a visible secret-free warning.
- Duplicate endpoint/model selectors use deterministic first-valid-entry-wins behavior even when a later duplicate requests another reasoning effort, with a visible secret-free warning.
- Repository agent guidance requires KISS, semantic best-effort recovery for applicable artifacts, independent validation of configured list entries, deterministic duplicate handling, visible secret-free warnings, and safe isolation rather than guessing safety-critical identities or stopping the parent flow.
- No arbitrary configured-model count limit is imposed, and preparation logs repository, model, and derived Copilot job counts.
- Native availability distinguishes unavailable CLI, required authentication, discovery failure, and an absent exact model.
- External availability distinguishes unknown endpoint label, incompatible endpoint capability, discovery failure, and absent exact model without persisting endpoint credentials.
- A valid but unavailable model remains one scheduled Copilot coverage job per repository and produces an honest unavailable result without preventing available siblings from running.
- For `R` repository targets and `M` valid configured model specifications, preparation creates exactly `R × M` Copilot child jobs in addition to every unchanged existing review group.
- One matrix group is created per model specification, and every group references the complete prepared repository target list.
- In the first pass and every repeated pass of the Copilot-enabled generic review group, all existing and Copilot groups enter one existing `subflowWave`; no second Copilot wave is introduced.
- The later one-shot `review_artifacts_main` batch explicitly disables Copilot additions and remains otherwise unchanged.
- Application-level scheduling admits all viable existing and Copilot children while earlier children are still running, and the parent waits for every child to settle.
- Every Copilot child instance identity contains the stable model-group identity, repository target identity, and `copilot_review` flow name.
- Stable model and child identities do not contain reasoning effort and do not change when unrelated endpoint entries are reordered.
- Every child uses an isolated workspace and immutable pinned input containing its repository target, base, head, wave, model, reasoning effort, availability snapshot, and external endpoint identity when applicable.
- The `copilot_review` child uses one native flow-service step that derives all launcher arguments from persisted scheduler input, generates the pinned instructions deterministically, and awaits terminal launcher completion without an LLM wrapper or tool-session polling.
- Persisted effective groups and wave progress support deterministic resume without duplicating previously created Copilot children.
- Parent cancellation prevents later admissions and settles or cancels active Copilot children through the existing wave behavior.
- Each available child invokes the locally installed Copilot CLI exactly once using `CODEINFO_COPILOT_CLI_PATH` or `copilot` from `PATH`.
- The invocation uses local non-interactive `/review`, the exact pinned `base...head`, exact model ID, configured reasoning effort, JSONL output, closed stdin, `--no-ask-user`, `--no-auto-update`, `--no-remote`, and `--no-remote-export`.
- The launcher validates the repository root and existence and identity of pinned commits before contacting any provider.
- The child passes exactly one `--allow-all` flag so Copilot has full tool, path, and URL permissions inside CodeInfo's Docker isolation boundary, matching the existing Codex and OpenCode review policy. It retains closed stdin, disabled optional Git locks and terminal prompts, disabled built-in GitHub MCP access, `--no-remote`, `--no-remote-export`, provider-secret isolation, canonical artifact containment, and explicit instructions prohibiting source or Git modification.
- Native launches remove inherited `COPILOT_PROVIDER_*`, `COPILOT_MODEL`, broad external endpoint configuration, and broad key maps while mapping `CODEINFO_COPILOT_HOME` to `COPILOT_HOME`.
- External launches re-resolve the selected endpoint immediately before execution, require the snapshotted label and normalized endpoint identity to still match, and expose only the selected OpenAI-compatible completions base URL, optional key, and exact model to the child.
- Endpoint identity drift becomes an isolated unavailable result before replacement credentials or model discovery are used.
- Credentials are never placed in command arguments, flow input, resume state, job metadata, normalized output, or logs; credential values are redacted from captured output and credential variable names are registered as secret environment variables.
- Every Copilot job retains secret-free invocation metadata, raw JSONL, raw stderr, numeric exit status, timestamps, repository target, pinned commits, endpoint label and normalized identity when external, model, reasoning effort, and inner Copilot usage when reported.
- JSONL normalization tolerates unknown event types, preserves raw output when normalization is incomplete, and honestly represents success, partial output, failure, timeout, cancellation, unavailable setup, and not-launched outcomes through normalized status, exit code, and diagnostics.
- Usage represents the inner Copilot CLI invocation rather than the wrapper agent and preserves input, cached input, output, reasoning, premium-request, duration, and code-change fields when Copilot reports them.
- Every prompt explicitly instructs Copilot to exclude changed repository-root-relative `planning/**` content from inspection and findings and supplies `git diff <base>...<head> -- . ':(exclude)planning/**'` as the review diff command.
- The prepared review-instructions file remains available as the authoritative story context, so planning changes are excluded without removing acceptance criteria and scope information.
- Invocation and normalized-result artifacts record `planning/**` in `excluded_paths`.
- In a mixed change range, the immutable prompt keeps non-planning implementation changes in review scope while excluding planning changes. When only planning files changed, it instructs Copilot not to invent implementation findings and to report honestly that no reviewable implementation changes remain.
- Copilot never creates a remote GitHub pull-request review, exports a session, or delegates to a remote coding agent.
- Existing verification and reconciliation discover variable numbers of child artifacts generically, retain per-job provenance and usage independently, and merge supported findings into one normal batch reconciliation.
- Focused sequential parser, availability, matrix, concurrency, launcher, flow, workspace, schema, prompt-contract, server-build, and Compose-build proof passes.

### Out Of Scope

- Creating remote GitHub pull-request reviews, publishing review comments, exporting Copilot sessions, or delegating to remote coding agents.
- Changing global chat model lists, chat defaults, dynamic chat provider discovery, provider-local chat configuration, or existing Codex review model configuration.
- Selecting external endpoints implicitly because their advertised model names happen to match.
- Routing the first implementation through CodeInfo's internal OpenAI-compatibility proxy.
- Adding an arbitrary Copilot model-count limit or a new global dynamic model-selection interface.
- Adding a second review wave, changing existing non-Copilot review groups, or changing reconciliation to assume a fixed provider count.
- Updating the behavior, launchers, model configuration, output contracts, or substantive prompt contracts of existing Codex, OpenCode, multi-agent, cross-repository, or other review mechanisms; only provider-neutral batch integration needed to admit and reconcile Copilot siblings is in scope. The terminology-only repair that restores the disposition prompt's already-tested `materiality survivors` phrase does not authorize any behavior change.
- Adding a client configuration UI or requiring client code changes for model-specific job labels.
- Adding a synthetic commit, filtered repository, Git shim, or provider-specific hard filesystem sandbox to hide planning files mechanically.
- Changing the shared `planning/**` review exclusion used by other review harnesses.
- Guaranteeing that Copilot CLI internals never observe changed-file metadata for excluded planning paths; the implemented boundary is explicit model instruction plus Git exclusion pathspec.
- Redesigning or fixing Copilot or server tests so they can use `node:test` runner concurrency, worker threading, parallel wrappers, or simultaneous shared-fixture execution.
- Diagnosing or repairing the process-environment, shared in-memory state, fixture, database, port, or cleanup isolation required to make those tests parallel-safe.
- Running or repairing `npm run test:summary:all:parallel`; this story uses sequential targeted tests and the repository build wrappers.
- Manual testing, manual Compose startup proof, provider login, screenshots, and other human-operated validation are not desired for this story.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

No manual testing is desired for this story. The implemented behavior is covered by sequential fake-provider, flow, workspace, prompt-contract, server-build, and Compose-build proof. Human-controlled Copilot login, live provider spending, browser proof, and remote GitHub interaction are deliberately outside this story.

### Questions

## Code Review Findings

- Findings recorded: `July 30, 2026 at 1:55:01 AM GMT+1 [locale=en-US; timeZone=Europe/London]`
- Review batch: `0000065-rw-20260729T223632Z-e143e74f`
- Review cycle: `0000065-rc-20260729T223631Z-72cb0b36`
- Reviews attempted:
  - `codex_review [current_repository]` (`codex_review`, job `target_reviews:current_repository:codex_review`, target `current_repository`) — completed with supported findings R-001 and R-002; direct numeric process exit status was not reported, while terminal completion and response were retained
    - Input tokens: `0`
    - Cached input tokens: `0`
    - Output tokens: `0`
  - `open_code_review [current_repository]` (`open_code_review`, job `target_reviews:current_repository:open_code_review`, target `current_repository`) — completed bounded review with no supported findings in its 14-file reviewable bundle; 13 changed files were excluded, so coverage is partial
    - Input tokens: `2,482,763`
    - Cached input tokens: `2,336,512`
    - Output tokens: `16,221`
  - `cross_repository_review` (`cross_repository_review`, job `story_review:cross_repository_review`, target `cross-repository story scope` / `current_repository`) — not applicable because the immutable input contained only one repository target
    - Input tokens: `126,594`
    - Cached input tokens: `103,424`
    - Output tokens: `2,049`
  - `Copilot: openrouter/deepseek/deepseek-v4-pro (none) [current_repository]` (`copilot_review`, job `copilot-external-openrouter-deepseek-deepseek-v4-pro-5112d7e6b73b:current_repository:copilot_review`, target `current_repository`) — provider completed; verifier-recovered evidence supports R-001 and R-002, superseding the original clean conclusion
    - Input tokens: `Not reported`
    - Cached input tokens: `Not reported`
    - Output tokens: `1,902`
  - `Copilot: openrouter/qwen/qwen3.7-flash (none) [current_repository]` (`copilot_review`, job `copilot-external-openrouter-qwen-qwen3-7-flash-b911d8a6159b:current_repository:copilot_review`, target `current_repository`) — partial provider result after repeated 429 failures; no finding and no clean no-findings conclusion
    - Input tokens: `Not reported`
    - Cached input tokens: `Not reported`
    - Output tokens: `117`
  - `Copilot: claude-sonnet-5 (medium) [current_repository]` (`copilot_review`, job `copilot-native-claude-sonnet-5-f7be2099e956:current_repository:copilot_review`, target `current_repository`) — provider completed; verifier-recovered evidence supports R-001 and R-002, superseding the original clean conclusion
    - Input tokens: `Not reported`
    - Cached input tokens: `Not reported`
    - Output tokens: `1,350`

Batch usage totals: input `At least 2,609,357 reported; incomplete`; cached input `At least 2,439,936 reported; incomplete`; output `21,639 reported`; reasoning output `Not reported`; premium requests `At least 1 reported; incomplete`. Cached input is not added to input. The `attempts/87efe212612a771fe20310e53dfd256d189b7ded6b31dd0d119cf58831c682b9.md` orchestration record is retained in the settlement evidence; usage is recorded only from designated actual-review artifacts.

### Accepted

- None.

### Ignored for This Story

#### 1. Credential-like model selectors can be persisted and logged

- Finding ID or Review reference: `R-001`
- Review harnesses:
  - `codex_review [current_repository]` (`codex_review`, job `target_reviews:current_repository:codex_review`) — generated the finding.
  - `Copilot: openrouter/deepseek/deepseek-v4-pro (none) [current_repository]` (`copilot_review`, job `copilot-external-openrouter-deepseek-deepseek-v4-pro-5112d7e6b73b:current_repository:copilot_review`) — corroborated it through verifier-recovered evidence.
  - `Copilot: claude-sonnet-5 (medium) [current_repository]` (`copilot_review`, job `copilot-native-claude-sonnet-5-f7be2099e956:current_repository:copilot_review`) — corroborated it through verifier-recovered evidence.
- Simple description: `parseCopilotReviewModels` accepts any non-empty model ID that does not contain `::` and carries it into ordinary selector, model, and stable-identity fields. A credential-like value supplied in that field can therefore appear in persisted specification data or model diagnostics instead of being rejected as credential material.
- Example: An operator enters a non-empty URL- or credential-shaped string as the model ID in `CODEINFO_COPILOT_REVIEW_MODELS`. The parser treats it as a valid model selector and retains it in `selector`, `modelId`, and `stableId`; the evidence does not show an actual credential leak, only this retention behavior.
- Why ignored: This technically supported finding was fully removed at negative rejection gate 11. Current HEAD has no credential-pattern classifier, allowlist, configuration field, or runtime control that can distinguish a grammar-valid exact model ID from credential-like text. Classifying, rejecting, redacting, replacing, or otherwise reinterpreting such selectors would add an unauthorized validation or replacement policy. It is non-actionable for this story.

#### 2. One malformed endpoint sibling can disable valid external coverage

- Finding ID or Review reference: `R-002`
- Review harnesses:
  - `codex_review [current_repository]` (`codex_review`, job `target_reviews:current_repository:codex_review`) — generated the finding.
  - `Copilot: openrouter/deepseek/deepseek-v4-pro (none) [current_repository]` (`copilot_review`, job `copilot-external-openrouter-deepseek-deepseek-v4-pro-5112d7e6b73b:current_repository:copilot_review`) — corroborated it through verifier-recovered evidence.
  - `Copilot: claude-sonnet-5 (medium) [current_repository]` (`copilot_review`, job `copilot-native-claude-sonnet-5-f7be2099e956:current_repository:copilot_review`) — corroborated it through verifier-recovered evidence.
- Simple description: Copilot resolves the complete `CODEINFO_EXTERNAL_OPENAI_COMPAT_ENDPOINTS` list in one failure boundary. A malformed unrelated endpoint entry can make a valid explicitly selected endpoint unavailable as well.
- Example: The endpoint list contains one valid labeled endpoint and one malformed sibling. The shared whole-list resolver throws on the malformed segment, so `resolveCopilotReviewModels` returns unavailable external specifications instead of using the valid labeled endpoint.
- Why ignored: This finding survived negative scope but was removed by positive authorization. The story's independent-entry contract governs the newly introduced `CODEINFO_COPILOT_REVIEW_MODELS` list, not the separate pre-existing global endpoint list, and no comparison-base evidence proves partial recovery as preserved behavior. Splitting endpoint parsing, defining duplicate/conflict behavior, and warning on discarded entries would invent a new policy without exact story authority or an existing seam. It is technically supported but non-actionable for this story; materiality was not reached.

## Code Review Findings

- Findings recorded: `July 30, 2026 at 1:40:18 AM GMT+1 [locale=en-US; timeZone=Europe/London]`
- Review batch: `0000065-rw-20260729T233952Z-f493e79c`
- Review cycle: `0000065-rc-20260729T223631Z-72cb0b36`
- Reviews attempted:
  - `review_artifacts_main` (`review_artifacts_main`, job `target_reviews:current_repository:review_artifacts_main`, target `current_repository`) — partial review with one supported medium finding; a current-range blind-spot no-findings result survives only in mutable repository-level `work/blind-spots/review-result.md`, outside the immutable job directory, so its exact job provenance remains unavailable and no clean coverage is inferred
    - Input tokens: `5,419,889`
    - Cached input tokens: `4,960,512`
    - Output tokens: `62,700`

### Accepted

#### 1. External Copilot launches can inherit ambient `COPILOT_HOME`

- Finding ID: `F1`
- Review harnesses:
  - `review_artifacts_main` (`review_artifacts_main`, job `target_reviews:current_repository:review_artifacts_main`) — generated by the saturation stage and retained by the consolidated review output.
- Simple description: External Copilot launches preserve `COPILOT_HOME` from the parent environment and can therefore receive Copilot-home state outside the selected external endpoint, optional key, and exact model.
- Example: With the supported external-review path, the launcher starts from an environment containing `COPILOT_HOME` and builds the child environment. At current HEAD, `buildExternalCopilotReviewEnvironment` leaves that value or maps `CODEINFO_COPILOT_HOME`, so the child can use persistent or ambient Copilot state even though the operator selected a specific OpenAI-compatible endpoint and model; the existing test does not assert that the value is absent.
- Why accepted: The reviewed behavior is directly confirmed at current HEAD in `server/src/copilot/reviewLauncher.ts:342-365` and `:454-468`, and the proof seam is the existing child-environment capture in `server/src/test/unit/copilot-review-launcher.test.ts:331-392`. The story contract authorizes the repair through its external-launch requirement that only the selected endpoint, optional key, and exact model reach the child; its separate native `CODEINFO_COPILOT_HOME` requirement does not authorize the native home mapping for external launches. The supported scenario is realistic on the checked-in Compose path, and the consequence directly leaves an explicit external-isolation acceptance criterion incomplete, so it is materially worth changing completed code. The smallest demonstrated remedy is localized to the existing external environment builder and its existing focused test: remove inherited and externally mapped `COPILOT_HOME` for external launches while leaving native mapping unchanged. This does not alter any Out Of Scope provider, wave, planning-exclusion, manual-proof, or test-concurrency boundary. The existing seam makes the finding apparently suitable for the normal repair attempt rather than the stronger attempt; this disposition does not make a final implementation-task decision.

### Ignored for This Story

- None.

## Implementation Ideas

- Parse each configured model entry independently and retain deterministic environment order.
- Treat endpoint plus model as external model identity and reasoning effort as a setting rather than identity.
- Generate one dynamic matrix group per configured model so every group can carry model-specific static input while sharing the complete repository target list.
- Extend the existing `subflowWave` rather than creating a provider-specific scheduler or second wave.
- Persist dynamic effective groups and use stable instance and input hashes for resume.
- Reuse existing Copilot readiness and OpenAI-compatible endpoint facilities while keeping credentials launch-time only.
- Keep the launcher reusable in TypeScript with a thin checked-in shell/CLI entrypoint.
- Use Docker-contained `--allow-all` permissions with closed stdin, local-only flags, disabled built-in GitHub MCP access, provider-secret isolation, endpoint identity rechecks, timeouts, and cancellation.
- Normalize Copilot output into the existing review artifact conventions while retaining raw evidence.
- Keep unavailable models visible and let sibling reviews continue.
- Exclude `planning/**` through one launcher-owned constant reused in prompts and artifacts.
- Preserve generic verification and reconciliation so provider and model counts remain dynamic.

# Tasks

### Task 1. Define resilient Copilot model configuration and availability

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__done__`
- Git Commits: `550dcd1f`, `e90b80c2`, `ef01ccfb`, `17c63d35`

#### Overview

Introduce the optional model-list contract and resolve each native or explicitly qualified external model without allowing one bad entry to suppress safe siblings. Align the implementation with the repository's best-effort configuration and artifact-handoff policy.

#### Task Exit Criteria

- Blank configuration preserves existing review behavior exactly.
- Valid entries retain deterministic identity and order while malformed and duplicate entries produce secret-free warnings.
- Native and external availability are resolved independently and unavailable models remain visible.

#### Documentation Locations

- GitHub Copilot CLI programmatic `/review` and BYOK documentation: establish non-interactive review and external provider inheritance.
- Installed `copilot --help`, `copilot help permissions`, and `copilot help providers`: confirm supported reasoning, provider, security, and permission behavior.

#### Subtasks

1. [x] Add `server/src/flows/copilotReviewModels.ts` with the model specification, supported reasoning values, parser, stable identity generation, warning contract, native discovery, and external endpoint/model availability resolution.
2. [x] Implement independent entry validation, deterministic first-valid duplicate handling, environment-order preservation, exact model matching, and secret-free warning text.
3. [x] Register `CODEINFO_COPILOT_REVIEW_MODELS` and the launcher timeout in `server/src/config/startupEnv.ts`, then reuse Copilot readiness and OpenAI-compatible endpoint configuration without resolving external credentials during batch preparation.
4. [x] Update `AGENTS.md` so independent batch entries and imperfect review artifacts are handled with safe best effort, visible accounting, and no forced parent-flow stop.
5. [x] Configure `server/.env` with the built-in Kimi and Claude review models and preserve the operator-local native-plus-OpenRouter model configuration.
6. [x] Add parser and availability coverage in `server/src/test/unit/copilot-review-models.test.ts`.
7. [x] Update `README.md` with grammar, delimiters, exact endpoint qualification, reasoning values, availability behavior, authentication, and secret handling.
8. [x] Run targeted ESLint for the changed TypeScript configuration and test surfaces and resolve every issue.
9. [x] Run targeted Prettier checks for the changed configuration source, tests, and documentation and resolve every issue.

#### Testing

1. [x] Run the sequential server unit wrapper with `CODEINFO_SERVER_UNIT_CONCURRENCY=1` over `server/src/test/unit/copilot-review-models.test.ts`, `server/src/test/unit/copilot-review-groups.test.ts`, `server/src/test/unit/subflow-wave.test.ts`, and `server/src/test/unit/flows-schema.test.ts`; all 112 tests passed.
2. [x] Run `npm run build:summary:server`; the server build passed without warnings.
3. [x] Run targeted ESLint for `server/src/flows/copilotReviewModels.ts` and its unit tests; lint passed.
4. [x] Run targeted Prettier checks for `server/src/flows/copilotReviewModels.ts`, its tests, `README.md`, and `AGENTS.md`; formatting passed.

#### Implementation notes

- Parsing was changed from whole-list failure to entry-level recovery so valid models continue while unsafe entries are isolated.
- Duplicate endpoint/model selectors keep the first valid entry because reasoning effort is not model identity.
- Native discovery no longer depends on parsing external endpoint configuration.
- Availability snapshots never contain credentials or secret-bearing endpoint URLs.

---

### Task 2. Add repository-by-model groups to the existing review wave

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__done__`
- Git Commits: `e90b80c2`, `17c63d35`

#### Overview

Create one dynamic matrix group per resolved Copilot model and expand every group over all prepared repository targets. Preserve the existing wave's application-level concurrency, cancellation, collective settlement, and deterministic resume.

#### Task Exit Criteria

- Two repositories and three Copilot models create exactly six unique Copilot jobs alongside unchanged existing reviews.
- All jobs use the same `subflowWave`, and unavailable models still create terminal coverage cells.
- Persisted effective groups and child identities resume without duplication.

#### Documentation Locations

- Existing `subflowWave` flow schema and service implementation: define dynamic group bindings, stable instance identities, concurrent admission, cancellation, and resume behavior.

#### Subtasks

1. [x] Add `server/src/flows/copilotReviewGroups.ts` to parse and resolve configured models, log fan-out counts, and append one model-specific matrix group per resolved specification.
2. [x] Extend `server/src/flows/flowSchema.ts` and `server/src/flows/service.ts` with the `prepareCopilotReviewGroups` custom step and persisted `effective_review_groups`.
3. [x] Update `flows/review_batch.json` so preparation occurs after repository targets and the existing single `subflowWave` reads `effective_review_groups`.
4. [x] Preserve the existing first and repeated group inputs from `flows/two_phase_review_cycle.json`, enable Copilot for the repeated group's first and later passes, and explicitly preserve the later one-shot batch's Copilot disable.
5. [x] Update `server/src/flows/subflowWave.ts` to use optional group display names while keeping machine identity separate and including model group, target, and flow in every Copilot child identity.
6. [x] Add 2×3 matrix, unavailable-cell, blank-config, malformed-entry, duplicate, stable-identity, workspace-collision, and dynamic-schema proof in `server/src/test/unit/copilot-review-groups.test.ts`, `server/src/test/unit/subflow-wave.test.ts`, and `server/src/test/unit/flows-schema.test.ts`.
7. [x] Add controlled same-wave concurrency and persisted dynamic-value proof in `server/src/test/integration/flows.run.subflow.test.ts`.
8. [x] Run targeted ESLint for the matrix preparation, schema, service, wave, and test surfaces and resolve every issue.
9. [x] Run targeted Prettier checks for the matrix preparation, flow JSON, and test surfaces and resolve every issue.

#### Testing

1. [x] Run the sequential server unit wrapper with `CODEINFO_SERVER_UNIT_CONCURRENCY=1` over the Copilot groups, subflow wave, and flow schema tests as part of the 112-test targeted run; all tests passed.
2. [x] Run the sequential integration test selection `prepared Copilot|resuming a subflow wave` in `server/src/test/integration/flows.run.subflow.test.ts`; both tests passed.
3. [x] Run targeted ESLint for the matrix, wave, schema, service, and related test files; lint passed.
4. [x] Run targeted Prettier checks for the matrix, wave, schema, service, flow JSON, and related test files; formatting passed.

#### Implementation notes

- A single static matrix group could not vary model input, so preparation creates one group per model and points every group at the same target list.
- The existing launcher loop already admits children without waiting for completion, so no new concurrency mechanism was introduced.
- Dynamic effective groups are persisted before launch and wave progress reuses stable instance IDs and input hashes on resume.
- Blank configuration returns the original review groups unchanged.

---

### Task 3. Create isolated Copilot review child workspaces and flow integration

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2`
- Task Status: `__done__`
- Git Commits: `e90b80c2`, `17c63d35`, `1913d469`

#### Overview

Add the `copilot_review` child flow and give every repository/model cell an immutable private input and discoverable job workspace. Keep unavailable and failed children visible to generic verification and reconciliation without introducing provider-count assumptions.

#### Task Exit Criteria

- The Copilot child flow is discoverable and receives pinned target, wave, commit, model, reasoning, availability, and endpoint data.
- Model/repository workspaces cannot collide and interrupted workspace preparation resumes safely.
- Every child produces or recovers an honest result without stopping siblings.

#### Documentation Locations

- Existing Codex review flow and generic review workspace contract: define isolated job ownership, artifact placement, exact commit verification, one-launch behavior, and best-effort output recovery.

#### Subtasks

1. [x] Add `flows/copilot_review.json` and `codeinfo_markdown/run_copilot_review_workspace.md` using the generic review-job workspace contract.
2. [x] Extend `server/src/flows/reviewBatchWorkspace.ts` to pin `copilot_review_spec`, pre-create each private workspace, validate target ownership, and reconstruct missing immutable inputs during interrupted preparation.
3. [x] Require available external jobs to carry both normalized endpoint label and endpoint identity while rejecting external identity on native jobs.
4. [x] Ensure unavailable specifications produce secret-free not-launched artifacts and an honest normalized unavailable result without invoking Copilot.
5. [x] Preserve generic discovery, verification, disposition, and reconciliation instead of adding a fixed Copilot result count.
6. [x] Retain the terminology-only `materiality survivors` repair in `codeinfo_markdown/disposition_review_batch.md` required by its existing prompt-contract test without changing existing review behavior.
7. [x] Add flow discovery, schema, immutable input, workspace isolation, interrupted preparation, unavailable coverage, and target-boundary proof in `server/src/test/unit/review-batch-workspace.test.ts`, flow schema tests, and Python prompt-contract tests.
8. [x] Run targeted ESLint for workspace preparation and its tests and resolve every issue.
9. [x] Run targeted Prettier checks for workspace preparation, flow and prompt files, and tests and resolve every issue.

#### Testing

1. [x] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit -- --file server/src/test/unit/review-batch-workspace.test.ts`; all 3 tests passed.
2. [x] Run the flow-schema portion of the sequential 112-test targeted server run; all tests passed.
3. [x] Run `python3 -m unittest scripts.test.test_review_prompt_contracts`; all 47 tests passed.
4. [x] Run targeted ESLint for `server/src/flows/reviewBatchWorkspace.ts` and its tests; lint passed.
5. [x] Run targeted Prettier checks for the workspace, flow, prompt, and test files; formatting passed.

#### Implementation notes

- Workspace identity is derived from the complete child instance identity, preventing repository/model collisions.
- The pinned model specification is immutable flow input and contains no credential.
- Interrupted preparation reconstructs a missing pinned input inside the same relocked job boundary rather than creating another child.
- Reconciliation remains provider-neutral and discovers whatever completed child artifacts actually exist.

---

### Task 4. Launch local Copilot reviews securely and normalize their artifacts

- Repository Name: `Current Repository`
- Task Dependencies: `Task 3`
- Task Status: `__done__`
- Git Commits: `e90b80c2`, `17c63d35`, `1913d469`

#### Overview

Implement one reusable TypeScript launcher with a thin checked-in script entrypoint for native and external local Copilot `/review` execution. Validate pinned Git state first, constrain tools and environment, preserve raw provider evidence, and normalize status and usage honestly.

#### Task Exit Criteria

- Copilot launches exactly once with the exact pinned range, model, reasoning effort, local-only flags, closed stdin, and read-only permissions.
- Native and external child environments are isolated and credentials never persist or leak.
- Success, partial output, failure, timeout, cancellation, missing CLI, runtime drift, and malformed setup retain honest artifacts.

#### Documentation Locations

- GitHub Copilot CLI programmatic `/review` documentation: define non-interactive prompt and JSONL execution.
- GitHub Copilot CLI BYOK documentation and installed provider help: define external OpenAI-compatible completions environment.
- Installed Copilot permissions help: define positive Git subcommand permission patterns and deny precedence.

#### Subtasks

1. [x] Add reusable `server/src/copilot/reviewLauncher.ts`, argument adapter `server/src/copilot/reviewLauncherCli.ts`, and thin `scripts/run-copilot-review.sh`.
2. [x] Validate all explicit paths and identities, assigned workspace containment, repository root, pinned base and head commits, and current HEAD before provider contact.
3. [x] Build the exact local `/review` prompt and CLI arguments with model, reasoning, JSONL, non-interactive, no-update, no-remote, no-export, no-custom-instructions, and disabled GitHub MCP flags.
4. [x] Close stdin, bound execution with timeout and cancellation, launch exactly once, capture stdout and stderr separately, and record numeric exit status and timestamps.
5. [x] Replace broad Git permission with a positive allowlist of inspection subcommands, deny write tools and mutating Git commands as defense in depth, and disable optional Git locks and terminal prompts.
6. [x] Strip inherited provider variables for native launches and map `CODEINFO_COPILOT_HOME` to `COPILOT_HOME`.
7. [x] For external launches, re-resolve the selected endpoint by label and pinned normalized identity, verify completions and exact model availability, and expose only the selected endpoint/key/model to the child.
8. [x] Remove broad endpoint and key maps, keep credentials out of arguments and artifacts, register secret environment variable names, and redact captured credential values.
9. [x] Preserve raw JSONL with unknown events, stderr, invocation, exit status, timestamps, inner Copilot usage, and normalized status, exit-code, and diagnostic representations of success, partial output, failure, cancellation, timeout, and unavailable setup.
10. [x] Add fake-Copilot executable coverage in `server/src/test/unit/copilot-review-launcher.test.ts` for arguments, environment, stdin, launch count, JSONL, usage, errors, runtime drift, endpoint reassignment, security, timeout, and cancellation.
11. [x] Run targeted ESLint for the launcher, CLI adapter, script contract, and tests and resolve every issue.
12. [x] Run targeted Prettier checks for the launcher, CLI adapter, script, prompt, and tests and resolve every issue.

#### Testing

1. [x] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit -- --file server/src/test/unit/copilot-review-launcher.test.ts`; all 11 launcher tests passed.
2. [x] Run `npm run build:summary:server`; the server TypeScript build passed without warnings.
3. [x] Run targeted ESLint for `server/src/copilot/reviewLauncher.ts`, `server/src/copilot/reviewLauncherCli.ts`, and launcher tests; lint passed.
4. [x] Run targeted Prettier checks for the launcher, CLI adapter, script, prompt, and tests; formatting passed.

#### Implementation notes

- Endpoint identity is pinned at preparation and compared before credential resolution, preventing a reused label from silently changing providers.
- Positive Git inspection permissions replaced the original broad `git:*` allow rule.
- Unknown JSONL events remain in raw output and do not make otherwise useful output unavailable.
- Timeout and abort terminate only the direct Copilot process and preserve partial diagnostics.

---

### Task 5. Exclude planning changes and complete focused story proof

- Repository Name: `Current Repository`
- Task Dependencies: `Task 4`
- Task Status: `__done__`
- Git Commits: `9dff3f7d`, `032b0d1b`, `6ceebf50`, `6c6646fa`

#### Overview

Prevent Copilot from spending review effort on changed planning files while retaining the compact story requirements needed to evaluate implementation work. Complete focused sequential validation and document the full operational contract without expanding into unrelated parallel-suite repair or manual provider proof.

#### Task Exit Criteria

- Every Copilot prompt and prepared instruction explicitly excludes changed `planning/**` content while retaining story context.
- Invocation and normalized artifacts account for the exclusion.
- Targeted sequential tests, server build, and Compose build pass, and the complete feature is documented.

#### Documentation Locations

- Git pathspec documentation and installed Copilot CLI help: confirm the excluding diff syntax and absence of a native `/review` changed-path exclusion flag.

#### Subtasks

1. [x] Add one launcher-owned `COPILOT_REVIEW_EXCLUDED_PATHS` constant containing `planning/**`.
2. [x] Update the immutable `/review` prompt to prohibit inspection and findings for planning changes and supply the exact pinned Git excluding pathspec.
3. [x] Keep the prepared review-instructions file as the authoritative compact story context instead of asking Copilot to read changed plan files.
4. [x] Record `excluded_paths` in invocation and normalized artifacts.
5. [x] Extend launcher and Python prompt-contract tests for the exclusion prompt, exact Git command, wrapper instruction, and artifacts.
6. [x] Expand `README.md` and this story to document configuration, scheduling, execution, recovery, artifacts, security, exclusion behavior, and why proof must remain sequential at the test-runner level.
7. [x] Run targeted ESLint for all changed TypeScript source and test surfaces and resolve every issue.
8. [x] Run targeted Prettier checks for all changed Prettier-supported source, flow, prompt, documentation, and plan files and resolve every issue.

#### Testing

1. [x] Run the 11-test sequential Copilot launcher suite after adding the planning exclusion; all tests passed.
2. [x] Run the 47-test Python review prompt-contract suite after adding the planning exclusion; all tests passed.
3. [x] Run `npm run build:summary:server`; the server build passed without warnings.
4. [x] Run `npm run compose:build:summary`; both Compose build items passed.
5. [x] Run targeted ESLint for all changed TypeScript source and test files; lint passed.
6. [x] Run targeted Prettier checks for all changed Prettier-supported source, flow, prompt, documentation, and plan files; formatting passed.

#### Implementation notes

- The exclusion is intentionally prompt/pathspec based because Copilot `/review` exposes no native changed-path exclusion flag.
- Mixed ranges retain implementation changes; planning-only ranges must not produce invented implementation findings.
- The compact story context remains available even though changed planning files are out of review scope.
- The relevant integration harness owns process-wide environment and shared in-memory stores, so making it runner-parallel-safe requires separate isolation work that remains deliberately out of scope.
- The parallel all-tests wrapper, live provider spending, login, and manual testing also remain deliberately out of scope.

---

### Task 6. Harden Copilot review workspace path handling

- Repository Name: `Current Repository`
- Task Dependencies: `Task 5`
- Task Status: `__done__`
- Git Commits: `67e2d606`
- Created: `July 28, 2026 at 11:00:15 PM GMT+1 [locale=en-US; timeZone=Europe/London]`

#### Overview

Prevent Copilot review wrapper agents from corrupting long scheduler-assigned artifact paths by making the checked-in launcher derive every canonical input, work, and output location from one real job workspace. Retain the existing Copilot-specific provider security, exactly-once local `/review` execution, raw evidence, normalization, and best-effort unavailable coverage while adopting the safer workspace discipline already used by the other native review mechanisms.

#### Task Exit Criteria

- The wrapper passes one assigned workspace and semantic review identity arguments without selecting or retyping individual artifact paths.
- The launcher derives fixed contained paths, rejects workspace directories that resolve outside the assigned job, and preserves the existing workspace layout for resume and reconciliation.
- A pinned unavailable model produces complete terminal artifacts without launching Copilot.
- Focused sequential tests and required server and Compose builds pass without manual provider proof.

#### Documentation Locations

- `codeinfo_markdown/review_job_workspace_contract.md` and `codeinfo_markdown/run_copilot_review_workspace.md`: shared path ownership and Copilot wrapper execution contracts.

#### Subtasks

1. [x] Add one launcher-owned resolver for the real assigned workspace and its pinned specification, instructions, raw JSONL, stderr, status, invocation, usage, and normalized-result paths.
2. [x] Remove caller-selected instructions and artifact paths from the Copilot CLI while retaining repository, workspace, review identity, commits, model, reasoning, and optional endpoint identity.
3. [x] Read the pinned availability snapshot inside the launcher and generate deterministic unavailable artifacts without contacting Copilot.
4. [x] Preserve repository and commit checks, workspace containment, native and external environment isolation, credential redaction, exactly-once process handling, and normalization.
5. [x] Update the Copilot wrapper prompt to use one assigned job-directory variable, one canonical instructions path, semantic launcher arguments, and launcher-owned artifact paths.
6. [x] Extend launcher and Python prompt-contract tests for canonical path generation, containment, simplified CLI invocation, unavailable coverage, and removal of individual output arguments.
7. [x] Run targeted ESLint and Prettier checks for every changed supported implementation, test, prompt, and plan file.

#### Testing

1. [x] Run the sequential Copilot launcher suite with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`; all 15 tests passed.
2. [x] Run the sequential review-batch workspace suite with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`; all 3 tests passed.
3. [x] Run the sequential flow-schema suite with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`; all 87 tests passed.
4. [x] Run the targeted repository-by-model wave integration scenario with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`; the test passed.
5. [x] Run the complete Python review prompt-contract suite; all 47 tests passed.
6. [x] Run `npm run build:summary:server`; the server build passed without warnings.
7. [x] Run `npm run compose:build:summary`; both Compose build items passed.
8. [x] Run targeted ESLint and Prettier checks; all changed supported files passed.

#### Implementation notes

- Canonical filenames remain unchanged, so reconciliation and resumed review batches continue to discover the same artifacts.
- The launcher resolves `input/`, `work/`, and `output/` through the real assigned workspace and retains containment checks as defence in depth.
- Unavailable external snapshots may legitimately lack a resolved endpoint ID; the launcher records their endpoint label and reason without resolving credentials or launching Copilot.
- The first test-wrapper attempt exposed its multi-worker default and was stopped before tests ran; every successful server test invocation used the explicit concurrency-one override and exact source test path.
- Fixing the repository test harness so it can safely run tests in parallel remains out of scope, and no manual testing or live provider spending was performed or desired for this story.

---

### Task 7. Give Copilot reviews Docker-contained full access

- Repository Name: `Current Repository`
- Task Dependencies: `Task 6`
- Task Status: `__done__`
- Git Commits: `96e37f35`
- Created: `July 28, 2026 at 11:16:46 PM GMT+1 [locale=en-US; timeZone=Europe/London]`

#### Overview

Give local Copilot `/review` invocations the same practical full-access policy as the existing Codex and OpenCode reviews because CodeInfo's Docker container is the intended isolation boundary and restricted tool permissions prevented reliable review completion. Preserve the independent security boundaries that prevent remote review publication or delegation, protect provider credentials, close interactive input, validate pinned repositories and commits, and contain persisted evidence in each assigned review workspace.

#### Task Exit Criteria

- Every available native and external Copilot review passes exactly one `--allow-all` flag and no conflicting tool allowlist or denial flags.
- Docker is documented as the full-access isolation boundary, matching Codex and OpenCode.
- Remote control/export, built-in GitHub MCP access, interactive input, provider-secret exposure, duplicate invocation, and artifact-path escape remain disabled or prevented.
- Focused sequential tests and required server and Compose builds pass without manual provider proof.

#### Documentation Locations

- Installed GitHub Copilot CLI `1.0.75` help: confirm that `--allow-all` enables all tool, path, and URL permissions.
- `README.md` and `codeinfo_markdown/run_copilot_review_workspace.md`: operational full-access rationale and retained security boundaries.

#### Subtasks

1. [x] Verify the installed Copilot CLI's explicit full-access flag and compare the effective Codex, OpenCode, and Copilot permission policies.
2. [x] Replace Copilot's restricted available-tool, read, write-denial, and Git allow/deny arguments with exactly one `--allow-all` flag.
3. [x] Remove the obsolete Git inspection and mutation permission constants.
4. [x] Preserve closed stdin, local-only flags, disabled built-in GitHub MCP access, provider-secret isolation and redaction, repository and commit validation, exactly-once execution, cancellation, timeout, and canonical artifact containment.
5. [x] Update the wrapper prompt, README, story description, acceptance criteria, and implementation guidance to describe Docker-contained full access.
6. [x] Extend launcher and Python prompt-contract tests for native and external full-access arguments and retained security controls.
7. [x] Run targeted ESLint and Prettier checks for every changed supported implementation, test, prompt, documentation, and plan file.

#### Testing

1. [x] Run the sequential Copilot launcher suite with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`; all 15 tests passed.
2. [x] Run the sequential review-batch workspace suite with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`; all 3 tests passed.
3. [x] Run the sequential flow-schema suite with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`; all 87 tests passed.
4. [x] Run the targeted repository-by-model wave integration scenario with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`; the test passed.
5. [x] Run the complete Python review prompt-contract suite; all 47 tests passed.
6. [x] Run `npm run build:summary:server`; the server build passed without warnings.
7. [x] Run `npm run compose:build:summary`; both Compose build items passed.
8. [x] Run targeted ESLint and Prettier checks; all changed supported files passed.

#### Implementation notes

- This task supersedes Task 4's original read-only tool and positive Git-inspection allowlist policy; Task 4 remains unchanged as historical evidence of the earlier implementation.
- The installed CLI defines `--allow-all` as the combined all-tools, all-paths, and all-URLs policy, which is intentionally acceptable only because the review runs within CodeInfo's Docker boundary.
- Full access does not enable remote GitHub behavior: `--no-remote`, `--no-remote-export`, and disabled built-in MCP access remain mandatory.
- `--secret-env-vars` still removes provider credentials from shell and MCP environments and redacts them from Copilot output, while the launcher retains its own output redaction.
- Fixing parallel test-runner isolation remains out of scope, and no manual testing, live provider spending, login, remote session, or remote PR review was performed or desired.

---

### Task 8. Make Copilot review launch inputs and completion service-owned

- Repository Name: `Current Repository`
- Task Dependencies: `Task 7`
- Task Status: `__done__`
- Git Commits: `428f036d`
- Created: `July 29, 2026 [locale=en-US; timeZone=Europe/London]`

#### Overview

Remove the LLM wrapper from Copilot launcher argument transport and process supervision after live review evidence showed that a wrapper could mistype an otherwise-correct scheduler workspace or treat a yielded launcher as terminal. Run the existing reusable TypeScript launcher from a native flow-service step using the immutable child input and assigned review workspace directly, while preserving exactly-once local `/review`, cancellation, resume checkpoints, best-effort terminal coverage, provider isolation, and existing normalized artifacts.

#### Task Exit Criteria

- The `copilot_review` child flow contains a native service step rather than an LLM step that constructs a shell command.
- Repository, workspace, target, wave, instance, base, head, model, reasoning, availability, and endpoint identity come from persisted scheduler input without manual string transcription.
- The service owns and awaits the launcher process until terminal completion and propagates cancellation without orchestration-cell or tool-session polling.
- Existing successful, partial, failed, unavailable, usage, security, workspace, resume, and reconciliation contracts remain intact.
- Focused sequential tests and required server and Compose builds pass without manual provider proof.

#### Documentation Locations

- `flows/copilot_review.json`, `server/src/flows/service.ts`, and `server/src/copilot/reviewLauncher.ts`: native child-flow execution and launcher contracts.
- `README.md` and this story: operational behavior and proof scope.

#### Subtasks

1. [x] Add a native Copilot review flow-step schema and replace the LLM step in `copilot_review`.
2. [x] Resolve and validate every launcher input from the persisted child-flow payload and assigned private workspace without caller-selected path reconstruction.
3. [x] Generate the pinned Copilot instructions deterministically from immutable job inputs before provider contact.
4. [x] Await the reusable launcher directly in the flow service with cancellation and honest terminal result reporting.
5. [x] Remove obsolete wrapper-prompt dependencies and update documentation and story contracts for service-owned execution.
6. [x] Extend focused schema, service, and prompt-contract tests for exact input propagation, no LLM launch, terminal waiting, cancellation, and unavailable coverage, then rerun the existing launcher and workspace regressions.
7. [x] Run targeted ESLint and Prettier checks for every changed supported implementation, test, flow, documentation, and plan file.

#### Testing

1. [x] Run the sequential Copilot launcher unit suite with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`.
2. [x] Run the sequential native Copilot flow-step and schema suites with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`.
3. [x] Run the sequential review-batch workspace and repository-by-model wave suites with `CODEINFO_SERVER_UNIT_CONCURRENCY=1`.
4. [x] Run the complete Python review prompt-contract suite.
5. [x] Run `npm run build:summary:server`.
6. [x] Run `npm run compose:build:summary`.
7. [x] Confirm the branch diff and Git status contain only intended story changes before committing.

#### Implementation notes

- Live run `C` proved that the scheduler-persisted job, target, model, and endpoint inputs were correct; the remaining failures occurred while an LLM wrapper retyped the workspace and supervised a yielded tool process.
- Added the schema-only `runCopilotReview` step and changed `copilot_review` from an LLM step to that native step, removing the wrapper-agent launch boundary.
- Added strict cross-checks between the child payload, immutable wave target, pinned model snapshot, and canonical workspace directories before deriving launcher options.
- The native step now writes one deterministic instructions file from the pinned target and story context rather than asking an agent to reconstruct the review brief.
- The flow service directly awaits `runCopilotReview`, passes its inflight cancellation signal, and records the provider result only after the launcher returns terminally.
- Removed the unused Copilot wrapper prompt and updated README, story description, acceptance criteria, and prompt-contract proof for service-owned execution.
- The new five-test native-step suite, 88-test schema suite, and targeted service integration scenario passed sequentially; the integration fake remained blocked until explicitly released and was called exactly once.
- The unchanged 15-test launcher suite passed sequentially, covering local invocation, external and native environments, cancellation, artifacts, normalization, and security flags beneath the new native step.
- Fourteen workspace/group/wave tests and the targeted two-repository/three-model integration scenario passed sequentially, preserving the existing matrix, isolation, persistence, and same-wave behavior.
- Added focused native-step, schema, and service integration coverage while retaining the existing launcher/workspace regressions; the complete 47-test Python contract suite passed with the new native-flow assertions.
- Targeted ESLint passed with zero warnings after correcting import order, Prettier passed for every supported changed file, and Python compilation passed for the updated contract test.
- The final server summary build passed cleanly with no warnings.
- The Compose summary build passed both image items and confirmed the runtime flow assets were baked into the server image.
- Final diff and status inspection found only the intended native Copilot flow, tests, documentation, and Task 8 changes; `git diff --check` passed and no obsolete wrapper-prompt reference remains outside historical task notes.
- Manual Compose/provider proof remains undesired for this story, and parallel test-runner isolation remains out of scope.

---

### Task 9. Fix external Copilot launch environment isolation

- Repository Name: `Current Repository`
- Affected Repositories: `current_repository`
- Task Dependencies: `Task 8`
- Task Status: `__done__`
- Review Task Role: `review_finding_repair`
- Review Batch: `0000065-rw-20260729T233952Z-f493e79c`
- Review Cycle: `0000065-rc-20260729T223631Z-72cb0b36`
- Review Harnesses: `review_artifacts_main` (`review_artifacts_main`, job `target_reviews:current_repository:review_artifacts_main`)
- Addresses Findings: `F1` — External Copilot launches can inherit ambient `COPILOT_HOME`.
- Created: `July 30, 2026 at 1:55:54 AM GMT+1 [locale=en-US; timeZone=Europe/London]`

#### Overview

Remove `COPILOT_HOME` from external Copilot child environments so an external launch exposes only the selected OpenAI-compatible endpoint, optional key, and exact model. Preserve the existing native `CODEINFO_COPILOT_HOME` mapping and all other provider, endpoint, artifact, cancellation, and credential-isolation behavior.

#### Task Exit Criteria

- `buildExternalCopilotReviewEnvironment` no longer preserves inherited `COPILOT_HOME` or maps `CODEINFO_COPILOT_HOME` into an external child.
- `buildNativeCopilotReviewEnvironment` continues to map `CODEINFO_COPILOT_HOME` for native launches.
- The focused external-launch test proves that ambient and CodeInfo-native Copilot-home values are absent while the selected endpoint, optional key, exact model, and required security variables remain correct.
- No new parameter, schema, provider policy, retry, fallback, or orchestration path is introduced.

#### Documentation Locations

- `server/src/copilot/reviewLauncher.ts` and `server/src/test/unit/copilot-review-launcher.test.ts`: existing external/native environment builders and focused child-environment capture.
- `planning/0000065-users-can-exclude-planning-changes-from-copilot-reviews.md`: external child-environment acceptance criteria and F1 provenance.

#### Subtasks

1. [x] Update `server/src/copilot/reviewLauncher.ts`, specifically `buildExternalCopilotReviewEnvironment`, to delete inherited `result.COPILOT_HOME` after `withoutProviderEnvironment` and remove the external `CODEINFO_COPILOT_HOME` mapping. Leave `buildNativeCopilotReviewEnvironment` unchanged.
2. [x] Update the external-launch case in `server/src/test/unit/copilot-review-launcher.test.ts` to seed both an ambient `COPILOT_HOME` and `CODEINFO_COPILOT_HOME`, then assert the captured external child environment contains neither `COPILOT_HOME` nor the native home path while still containing only the selected endpoint, key, and model. Retain the existing secret-redaction, non-selected-endpoint, and native-home assertions.

#### Testing

1. [x] Run `npm run build:summary:server`; the server build must pass.
2. [x] Run `npm run compose:build:summary`; both supported Compose build items must pass.
3. [x] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit -- --file server/src/test/unit/copilot-review-launcher.test.ts`; the focused launcher suite must pass, including native-home preservation and external-home absence.
4. [x] Run `npm run compose:up`; the checked-in main `codeinfo` stack must start successfully through the repository-supported wrapper as automated smoke proof for the changed launcher/runtime surface.
5. [x] Run `npm run compose:down`; shut down the main test stack started by the preceding smoke-proof step through the repository-supported wrapper, including when the smoke proof fails after startup.
6. [x] Run `npm run lint`; fix all reported lint issues using the supported auto-fix path when appropriate.
7. [x] Run `npm run format:check`; fix all reported formatting issues using the supported formatter before manual cleanup when appropriate.

#### Manual Testing Guidance

None. The story explicitly excludes manual Compose startup, provider login, live provider spending, browser proof, screenshots, and remote GitHub validation.

#### Implementation Notes

- Settlement routed only the positively authorized, materially surviving F1 here. Removed findings R-001 and R-002 are preserved in the preceding batch-specific `Code Review Findings` block and must not be implemented by this task.
- The normal and stronger repair opportunities for F1 were unavailable in batch `0000065-rw-20260729T233952Z-f493e79c`; this task is the first open implementation owner, not a completed-review-fix record.
- Updated `buildExternalCopilotReviewEnvironment` to delete inherited `COPILOT_HOME` and removed its `CODEINFO_COPILOT_HOME` mapping; the native environment builder remains unchanged.
- Extended the external-launch capture test with ambient and native Copilot-home values and assertions that neither reaches the child; existing endpoint, model, key, redaction, and native-home coverage remains intact.
- The focused launcher wrapper initially exposed the preserved `CODEINFO_COPILOT_HOME` path in the external child environment; deleting that source variable from the external result closed the gap, and the rerun passed all 15 tests.
- Server build wrapper passed cleanly with zero warnings.
- Compose build summary passed both supported build items with zero failures.
- Main Compose smoke stack started successfully through the supported wrapper.
- Main Compose smoke stack shut down cleanly through the supported wrapper.
- Repository lint passed with zero reported issues.
- Repository format check passed; all tracked files matched Prettier style.
- Audit confirmed the scoped external-home isolation implementation and all recorded automated proof are present, with native home mapping preserved and no story-caused behavior drift. All subtasks and testing are complete, no live blocker is reported, and Task 9 is now honestly complete for final story closeout.
- Manual testing assessed as not applicable (task-scoped): external Copilot child-environment isolation has no required runnable, browser-visible, HTTP-visible, or otherwise externally observable proof surface beyond its completed focused automated capture test. Story and task guidance both exclude manual Compose startup, provider login, live-provider use, browser proof, screenshots, and remote GitHub validation; no stack was started and no further subtasks are needed.

---

### Task 10. Repair the shared Copilot chat-default test baseline

- Repository Name: `Current Repository`
- Affected Repositories: `current_repository`
- Task Dependencies: `Tasks 1–9`
- Task Status: `__in_progress__`
- Review Task Role: `shared_baseline_repair`
- Repair Boundary: this prerequisite owns only the stale chat-default test fixtures and assertions required to restore the repository's current baseline; it must not change Story 65 production behavior.
- Created: `July 30, 2026 at 4:00:00 AM GMT+1 [locale=en-US; timeZone=Europe/London]`

#### Overview

Restore the three pre-existing Copilot chat-default tests that still encode the old `copilot-gpt-5` default after mainline changed the supported default to `gpt-5.4-mini`. Keep the repair limited to the named test files and make the full sequential server-unit wrapper green before the final story revalidation task resumes.

#### Task Exit Criteria

- The three named tests represent the current `gpt-5.4-mini` default contract: fallback expectations match the current live model behavior, flag-clamping fixtures include the current default when zero warnings are intended, and intentional missing-default fixtures assert the normalization warning.
- No Story 65 production file or global chat-default implementation is changed by this task.
- The focused three-test wrapper passes and the complete sequential server-unit wrapper passes with concurrency one.
- Task 11 can resume its complete story closeout without carrying a known shared-baseline failure.

#### Subtasks

1. [x] Update only `server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts`, `server/src/test/unit/chatModels.copilot.test.ts`, and `server/src/test/unit/chatProviders.test.ts` so their fixtures and assertions explicitly match the current `gpt-5.4-mini` default and its documented normalization-warning behavior; do not change production chat-default code.

#### Testing

1. [x] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit -- --skip-build --file server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts --file server/src/test/unit/chatModels.copilot.test.ts --file server/src/test/unit/chatProviders.test.ts --test-name "codebase_question keeps the requested provider|copilot models route clamps unsupported configured defaults|providers route clamps unsupported Copilot config defaults"`; all three targeted baseline tests must pass.
2. [x] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit`; the complete sequential server-unit and integration surface must pass before Task 11 resumes.

#### Implementation Notes

- Planner repair re-owned the proven shared chat-default baseline seam as the next executable prerequisite. The current final closeout task is moved behind this bounded test-only repair so the implementation loop has a concrete owner and stopping condition.
- The current default change and the three stale tests are documented in Task 11's preserved blocking-answer research; no Story 65 product behavior is authorized by this prerequisite.
- Updated only the three named test fixtures and assertions to use `gpt-5.4-mini`, preserving the zero-warning clamping contract and leaving production chat-default code unchanged.
- The focused three-test server-unit wrapper passed with concurrency 1: 3 tests run, 3 passed, 0 failed. The complete server-unit proof remains for the task's later automated-proof step.
- Ran the complete `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit` wrapper successfully with 2,688 tests passed and 0 failed.

---

### Task 11. Revalidate the complete Copilot review story

- Repository Name: `Current Repository`
- Affected Repositories: `current_repository`
- Task Dependencies: `Tasks 1–10`
- Task Status: `__to_do__`
- Review Task Role: `final_revalidation`
- Review Batch: `0000065-rw-20260729T233952Z-f493e79c`
- Review Cycle: `0000065-rc-20260729T223631Z-72cb0b36`
- Final Revalidation Owner: this task owns whole-story closeout after the F1 repair and Task 10's shared-baseline repair.
- Created: `July 30, 2026 at 1:56:23 AM GMT+1 [locale=en-US; timeZone=Europe/London]`

#### Overview

Revalidate the complete approved Copilot review story after Task 9's external child-environment repair and Task 10's shared chat-default baseline repair. This is the sole final closeout owner and covers the current repository's server, flow, prompt-contract, review workspace, and Compose-build surfaces delivered across Tasks 1–10.

#### Task Exit Criteria

- Every lint and formatting subtask and every automated proof item is checked only after the named command passes against the post-Task-10 repository state.
- The final proof reflects the latest story-owned code and no story-caused failure remains unresolved.
- The final task remains last in the plan and is the only final revalidation owner for this review cycle.
- No manual, provider-login, browser, screenshot, remote GitHub, or parallel all-tests gate is added to the story.

#### Documentation Locations

- `AGENTS.md`: repository build, test-wrapper, and story test-runner concurrency requirements.
- `package.json`: supported lint, formatting, build, Compose, server-unit, and server-Cucumber commands.
- `planning/0000065-users-can-exclude-planning-changes-from-copilot-reviews.md`: whole-story acceptance criteria and sequential-proof contract.

#### Subtasks

Final-task repair scope: this task owns whole-story validation. If lint, formatting, or testing exposes a story-caused issue in code implemented by any earlier task, fix it within this final task when practical and rerun the affected checks. Do not reopen an older task solely to own that repair.

1. [ ] Run the repository-supported full lint command `npm run lint` for the current repository after Task 10.
2. [ ] Run the repository-supported full formatting check `npm run format:check` for the current repository after Task 10.

#### Testing

Final-task repair scope: the whole approved story is in scope for failures found by these checks. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected check. Do not reopen older tasks solely because their implementation is implicated.

##### Current Repository

1. [ ] Run `npm run build:summary:server`; the complete server build must pass after Tasks 9 and 10.
2. [ ] Run `npm run compose:build:summary`; both supported Compose build items and baked flow assets must pass.
3. [ ] Run `npm run compose:up`; the checked-in main `codeinfo` stack must start successfully through the repository-supported wrapper.
4. [ ] Run `python3 -m unittest scripts.test.test_review_prompt_contracts`; the complete Python review prompt-contract suite must pass.
5. [ ] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit`; the complete server unit and integration Node test surface must pass with the story-required runner concurrency of one.
6. [ ] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:cucumber`; the complete server Cucumber feature surface must pass sequentially.
7. [ ] Run `npm run compose:down`; shut down the main stack started by this task through the repository-supported wrapper after the full automated suites finish, or during failure cleanup if an earlier suite stops the proof sequence.
8. [ ] Run `npm run lint` again after build, runtime, and test proof; fix story-caused issues and rerun affected checks.
9. [ ] Run `npm run format:check` again last; fix story-caused issues and rerun affected checks.

The story has no client-owned implementation surface, browser surface, or live-provider requirement. Do not replace these sequential commands with `npm run test:summary:all:parallel`; the story explicitly excludes that parallel wrapper because its test harness uses process-wide mutable state.

#### Manual Testing Guidance

None. The story explicitly excludes manual Compose startup, provider authentication, live Copilot spending, browser or screenshot proof, and remote GitHub interaction. Automated proof is the only validation required for this final task.

#### Implementation Notes

- This task is the single final revalidation owner after Task 9 and Task 10, and preserves the partial review-coverage limitations recorded for the settlement pass.
- Ran `npm run lint` successfully with exit code 0 and no reported issues; the lint subtask is complete.
- Ran `npm run format:check` successfully with exit code 0; all matched files use Prettier code style and the formatting subtask is complete.
- Ran `npm run build:summary:server` successfully with exit code 0 and no wrapper-reported warnings.
- Ran `npm run compose:build:summary` successfully; both Compose build items passed and runtime assets were baked.
- Ran `npm run compose:up` successfully; the checked-in main stack reached healthy server state and started all services.
- Ran `python3 -m unittest scripts.test.test_review_prompt_contracts` successfully; all 47 tests passed.
- Repaired `requirePrivateInput` validation ordering so missing private input directories report the intended error before contained-path checks; the targeted review-batch workspace wrapper passed all 3 tests, and the full server unit wrapper passed 2,685 of 2,688 tests with the story-caused failure resolved.
- Ran `npm run compose:down` during failure cleanup; the main stack was shut down through the supported wrapper.
- **RESOLVED ISSUE** Automated proof stopped at Testing item 5 (`CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit`). After the repair and a full rerun, three unchanged pre-story chat-default tests still fail: the Copilot codebase-question fallback selects `gpt-5-mini` instead of the expected `copilot-gpt-5`, and two Copilot route tests report one warning instead of zero. The failures reproduce in isolated targeted runs and the affected chat-default files have no story-owned diff. Planner repair now assigns that shared-baseline repair to Task 10 before this final task resumes; the original live blocker is retained here as historical evidence rather than an active blocker on the queued closeout task.
- **BLOCKING ANSWER** Research proves this is a shared wrapper or baseline seam, specifically stale chat-default test expectations, not a Story 65 product defect. Repository-first `code_info` research found the same ownership pattern in [Story 54 Task 14](planning/0000054-users-can-ingest-repositories-with-large-text-files-faster.md), which kept the required full server-unit wrapper as the completion gate for an unrelated suite failure, and in [Story 56 Task 4](planning/0000056-users-can-use-copilot-as-a-first-class-chat-provider-with-shared-agent-flags-and-defaults.md) and [Story 57 Task 35](planning/0000057-provider-neutral-agent-runtime-config-and-codeinfo-agents.md), which moved ownership only after evidence proved a shared baseline seam. Direct repository evidence shows the three failing files have no Story 65 diff (`git diff main...HEAD -- server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts server/src/test/unit/chatModels.copilot.test.ts server/src/test/unit/chatProviders.test.ts server/src/chat/copilotModelSupport.ts` is empty for those paths), while mainline commit `d1a12e4f` changed `DEFAULT_COPILOT_MODEL` from `copilot-gpt-5` to `gpt-5.4-mini` and updated only some related expectations. The fresh supported targeted wrapper run `CODEINFO_SERVER_UNIT_CONCURRENCY=1 npm run test:summary:server:unit -- --skip-build --file server/src/test/mcp2/tools/codebaseQuestion.happy.test.ts --file server/src/test/unit/chatModels.copilot.test.ts --file server/src/test/unit/chatProviders.test.ts --test-name "codebase_question keeps the requested provider|copilot models route clamps unsupported configured defaults|providers route clamps unsupported Copilot config defaults"` ran exactly 3 tests and failed all 3; its artifact is [test-results/server-unit-tests-2026-07-30T03-19-33-986Z.log](test-results/server-unit-tests-2026-07-30T03-19-33-986Z.log). The log proves the MCP test expects `copilot-gpt-5` while the current resolver returns `gpt-5-mini`, and both route tests expect zero warnings while the current resolver emits one normalization warning.
- **BLOCKING ANSWER** External-library and issue-resolution research confirms that targeted diagnosis cannot be substituted for the required full-suite result. The official [Node.js test-runner documentation](https://nodejs.org/api/test.html) states that any failing test sets the process exit code to 1, and documents `--test-name-pattern` and `--test-rerun-failures` as filtering/rerun tools rather than ways to make a failing full suite green; [DeepWiki's nodejs/node guidance](https://deepwiki.com/search/what-is-the-supported-behavior_1cde3c19-f650-4c3b-b280-7bcdb8cae8c8) and the Context7 `/nodejs/node` documentation confirm the same process-isolation and targeted-diagnosis model. A direct current-runtime probe of `resolveCopilotDefaultModel` proves the repair shape: with no current default in the fixture it returns `gpt-5-mini` and a normalization warning, while adding live `gpt-5.4-mini` returns `gpt-5.4-mini` with no warning. The chosen solution is therefore to re-own or reorder this prerequisite baseline repair outside Story 65, update the three stale fixtures/assertions to the current `gpt-5.4-mini` contract (including the normalization-warning expectation where the fixture intentionally omits that model, or including it when the test is only about flag clamping), then rerun the full sequential server-unit wrapper before continuing items 6, 8, and 9. This fits the local repository because the failing surfaces predate Story 65 and the story's final task must not change unrelated chat-default behavior. Rejected alternatives are changing Story 65 production code, silently weakening or skipping the three tests, marking the full wrapper complete from the targeted run, repeatedly rerunning the unchanged full wrapper without repairing its stale baseline, or adding a test-runner force-exit/parallel workaround; each would hide or mis-own the proven baseline contract instead of restoring it. The live `**BLOCKER**` remains because the prerequisite baseline repair and a fresh green full-wrapper artifact are still unavailable.
- Planner repair inserted Task 10 as the explicit prerequisite owner, moved this final task to `__to_do__`, and reset its closeout checks because the baseline test edits will make earlier proof stale. The live blocker was therefore retired as a historical resolved issue on this queued task; Task 10 remains the active executable owner until its bounded test repair and full server-unit proof pass.

---
