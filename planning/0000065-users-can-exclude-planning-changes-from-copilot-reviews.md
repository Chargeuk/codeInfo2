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
