# Story 0000053 – Codex Terra and agent fork upgrade (manual work)

## Description

Upgrade the OpenAI Codex CLI and server SDK to their latest matching stable release, modernize Terra agent routing and native fork behavior, and add automatic child handover. Preserve existing provider identities, conversation resume behavior, approval safety, and established error handling.

## Acceptance Criteria

- `@openai/codex` CLI and server `@openai/codex-sdk` target exactly `0.167.1`; the registry check on 2026-11-11 confirmed both latest stable versions are `0.167.1` and the SDK declares CLI `0.167.1`. Keep the lockfile and `server/npm-global.txt` Docker global install aligned.
- Terra is available through the configured environment/fallback/model picker while retaining thinking effort where supported.
- Both `codeinfo_agents` and `manual_testing/codeinfo_agents` contain the required Terra high and research agent variants; missing lite variants are added to the manual catalog. Ordinary targeted children use `research_agent_lite` or `research_agent_med` by complexity. Escalation is `research_agent_lite` → `research_agent_med` → `research_agent`; only `research_agent_max` is reserved as a last resort when completely stuck. Respect leaf, human, and governing-flow constraints.
- Approval is explicitly `never` for the affected agents and remains so. Codex uses Responses only: remove the completions fallback in `codexConfig.ts` and correct the misleading example.
- Existing chat provider identities and resume behavior remain intact. Native forks continue using `lastTurnId`/`excludeTurns`, with deprecated full-history pagination modernized.
- Child handover is sent automatically as the first normal child message through the regular run path. Open the child without waiting for a model reply; acknowledge and await the user without tool use. Preserve existing child/error/once-only handling. Do not add a special acknowledgement parser, reply gate, retry loop, or claim rollout-file persistence is proven.
- Scoped regressions, required lint/format/build checks, exactly one final full-suite stress run, and the specified manual proof pass on the unchanged final candidate.

## Out Of Scope

- KadShow and flows outside this repository.
- Live Copilot proof or changes to the protected local stack.
- Changing existing provider identities, resume semantics, approval policy, or general error handling beyond the specified upgrade behavior.

## Implementation Plan

### Instructions

1. Work on the already checked out `manual_work/0000053-codex-terra-and-agent-fork-upgrade` branch. Do not change branches or commit/push.
2. Complete tasks in order. The coder owns code, configuration, and test edits and immediately updates implementation checkboxes and notes. The tester owns proof checkboxes and notes. Coordinate plan edits sequentially; do not overlap writers.
3. Treat prior main-stack baseline success only as baseline evidence, not upgrade proof. The baseline stack was stopped at the user's request; the protected local stack is running and must not be stopped.
4. Do not add helpers, infrastructure, abstractions, or refactors without a verified need. Meaningful scoped regressions precede lint, formatting check, and builds. Run exactly one final unchanged-candidate `npm run test:summary:all:stress`; use `npm run test:summary:all:parallel` only if stress cannot run, recording the reason.
5. For manual proof, use the main stack at `http://localhost:5001` and `http://localhost:5010`, OpenAI only, no live Copilot, and preserve existing login/data. Shut down the main stack after proof. Never stop the local stack.

## Tasks

### Task 1. Upgrade Codex dependencies and Terra model configuration

- Task Status: `__done__`

#### Overview

Align the CLI, server SDK, lockfile, Docker global install, and Terra model selection/fallback while retaining supported thinking effort.

#### Subtasks

1. [x] Set CLI and SDK to `0.167.1` (verified latest matching stable versions on 2026-11-11; SDK declares CLI `0.167.1`) and update package manifests, lockfile, and `server/npm-global.txt` consistently.
2. [x] Add Terra environment/fallback/model-picker support and retain thinking effort where valid.
3. [x] Add Terra high and research agent variants to both agent catalogs; add any missing lite variant to the manual catalog.

#### Testing

1. [x] Add/update focused dependency/config and model-picker regressions for version alignment, Terra selection/fallback, and supported thinking effort.

#### Implementation Notes

- Pinned CLI/SDK and Docker global package to 0.167.1; ran the authorized package-lock-only, ignore-scripts install, then corrected stale nested lock entries using exact registry version/dist/dependency metadata because npm left those entries unchanged. No dependencies were installed or scripts executed.
- Added Terra to the tracked environment and fallback discovery list; the picker consumes server model capabilities and retains the existing reasoning controls without changing saved model/provider identities.

- Switched the five requested roles in both catalogs to Terra/high, copied each catalog's research agent into research_agent_med with Terra/high and unchanged tools/permissions, and added the missing manual lite counterpart. Approval remains never.

- Authored pin/SDK dependency, fallback/model capability, Terra picker/effort, and saved endpoint identity regressions; updated affected pre-existing catalog/toolchain expectations. All execution and proof checkboxes remain parent/tester-owned and pending.

- Proof (2026-11-11): Focused client checks passed 22/22. The selected server wrapper passed all Task 1 regressions; aggregate was 233 passed, one unrelated Task 3 native-fork cleanup failure, and two gated proofs skipped. The new test and modified client tests still need formatter repair; see parent handoff.

- Full-stress repair (2026-11-11): aligned the active startup stable-version guard with the CLI/SDK/lock/global pin at 0.167.1; preserved its historical event/marker identifiers. Updated the existing higher-stable rejection fixture from 0.163.0 to 0.168.0; the lower-stable and prerelease fixtures remain valid. Existing guard success/alignment and three integration assertions supply regression coverage; no duplicate tests were added. Repair not executed; focused and full-candidate proof remain parent/tester-owned.

### Task 2. Update research routing and Codex Responses configuration

- Task Status: `__done__`

#### Overview

Apply the agreed research escalation policy and remove the misleading Codex completions fallback/example while preserving approval behavior.

#### Subtasks

1. [x] Configure research coordination to use `research_agent_lite` or `research_agent_med` for ordinary targeted children according to complexity; do not route ordinary targeted work to `research_agent` or `research_agent_max`.
2. [x] Enforce `research_agent_lite` → `research_agent_med` → `research_agent` escalation, respecting leaf-agent, human, and governing-flow constraints. Reserve only `research_agent_max` as a last resort when completely stuck.
3. [x] Set affected agents' approval explicitly to `never`; remove the completions fallback from `codexConfig.ts` and correct the misleading example.

#### Testing

1. [x] Add/update focused regressions for complexity routing, escalation constraints, and Codex Responses-only configuration with approvals preserved.

#### Implementation Notes

- Both research coordinators now route ordinary targeted questions to lite or med by complexity, including runtime investigations; removed proactive max routing.

- Applied lite → med → coordinator escalation in both catalogs, with max restricted to completely stuck last-resort evidence and explicit leaf/human/governing-flow precedence.

- Kept affected approval policies explicitly never. Codex runtime config now reuses endpoint capability validation and emits only responses; corrected the vLLM example without changing shared/Copilot compatibility handling.

- Authored both-catalog configuration/tool/permission and routing/escalation policy assertions, plus completions-only Codex rejection coverage. These static prompt assertions do not claim model behavior proof; tests have not run.

- Proof (2026-11-11): The selected server wrapper passed all Task 2 catalog, routing/config, and Responses-only regression cases. Aggregate was 233 passed, one unrelated Task 3 native-fork cleanup failure, and two gated proofs skipped. The repository lint/format checks remain blocked by findings reported to the parent.

### Task 3. Modernize native forks and implement automatic child handover

- Task Status: `__done__`

#### Overview

Retain native fork boundaries and normal run-path behavior while modernizing pagination and making handover the first child message.

#### Subtasks

1. [x] Preserve `lastTurnId`/`excludeTurns` fork behavior and modernize deprecated full-history pagination.
2. [x] Send handover automatically as the first normal child message; open the child without waiting for a model reply.
3. [x] On handover, acknowledge and await the user without tool use; preserve child, error, and once-only handling. Do not add an acknowledgement parser, reply gate, retry loop, or rollout-file persistence proof.
4. [x] Preserve existing provider identities and resume behavior.

#### Testing

1. [x] Add/update focused regressions for fork boundaries, pagination, automatic first-message handover, acknowledgement/await behavior, error handling, and once-only handling.

#### Implementation Notes

- Replaced legacy full thread/read with ascending thread/turns/list pages requesting full items, matching tagged 0.167.1 protocol. Exact lastTurnId/excludeTurns forks and header-only completion reads remain intact.

- New Codex forks publish the child then submit the handover through startAgentInstruction, returning on acceptance rather than waiting for a reply. Normal persistence owns the handover turn; no synthetic duplicate row is copied. Existing injection operation records keep their legacy recovery path.

- Handover ends with an explicit ACKNOWLEDGE ONLY/no tools/no work/await user instruction after the captured target prompt and inherited legacy context. A durable once-only attempt claim prevents duplicate dispatch on reopen/retry; normal run errors/cancellation preserve the published child. Startup failure is returned to the child view without automatic replay.

- Reused the existing pinned provider/model/endpoint and native thread resume path without changing identity resolution. Added normal-run regression coverage for a Terra child whose catalog later names Sol, including completion/failure/cancellation and subsequent intentional resume; authored only, not executed.

- Authored native multi-page boundary, normal handover dispatch/deduplication, publication recovery, retained-child startup-error UI, normal-run completion/error/cancel/resume, and fork-of-fork regressions; adapted opt-in Mongo/native proof to the normal-message contract. Tests/builds/typechecks/lint/format/manual proof were not run.
- The dispatch claim records an at-most-once attempt, not a reply or native durability proof. A process exit between that claim and normal-run startup can leave the preserved child without automatic replay; no retry framework was added.

- Repair follow-up: inspected and applied the tester-provided four-file Prettier reference patch without running a formatter. Task 1/2 focused proof marks remain intact; task 3 proof remains pending retest.

- Repair follow-up: separated accepted-run delivery-marker persistence from startup failure handling. A failed marker write now warns through the existing logger and preserves the successful child result and durable once-only claim; no child cleanup or automatic replay was added. Retest pending.
- Repair follow-up: corrected the legacy pagination fixture to expect the JSON wire shape (undefined cursor omitted), and changed fixture handler exceptions into RPC errors so a synchronous assertion cannot strand stdin before finish and mask its cause with the production close deadline. Reordered the two cited imports. Production close deadlines and exit/durability checks are unchanged; retest pending.

- Repair regression authorship: added an accepted-starter/failed-marker test asserting a truthful successful child result, warning evidence, preserved child, and one dispatch across repeated facade/worker requests; added a native-fixture assertion failure test requiring the original RPC failure and confirmed graceful writer termination. These repairs and regressions have not been executed; task 3 testing remains unchecked for the parent tester.

- Proof (2026-11-11): focused server regressions passed 65/65 across agent-fork-service, agent-fork-native, agent-fork-writer-close, and agent-fork-instruction, including the repaired regressions. The server wrapper build passed. Earlier repair notes above are superseded for test status by this run; broader stress and manual proof remain pending.

### Task 4. Complete automated and manual proof

- Task Status: `__done__`

#### Overview

Run the mandatory checks in order on the final unchanged candidate and record actual results. The tester owns these proof updates.

#### Subtasks

1. [x] Confirm implementation tasks 1–3 and their scoped regressions are complete before broad validation.

#### Testing

1. [x] Run focused regression tests for the changed behavior using repository wrappers where available.
2. [x] Run the required repository lint checks.
3. [x] Run the supported formatting check without auto-fixing; record any required formatter edits for the implementation owner.
4. [x] Run required client, server, and Compose builds using repository build wrappers.
5. [x] Run exactly one final unchanged-candidate `npm run test:summary:all:stress`. If stress cannot run, record the concrete reason and run `npm run test:summary:all:parallel` instead.
6. [x] Perform manual proof against the main stack at localhost:5001 and localhost:5010, OpenAI only and no live Copilot; preserve existing login/data and verify the agreed upgrade/fork/handover behavior.
7. [x] Shut down the main proof stack after manual proof; confirm the protected local stack was left running.

#### Implementation Notes

- Formatting-only repair (2026-11-11): inspected every hunk and applied the tester's repository-root Prettier reference patch `/tmp/codeinfo2-precommit-format-reference-0000053/12-server-files.patch` to exactly its 12 server paths without conflicts or semantic changes. No formatter, lint, tests, builds, or runtime checks were executed; the formatting checkbox remains pending tester verification, with prior automated/manual proof preserved. No staging or commits were performed.

- Proof (2026-11-11): focused server tests passed 65/65; client focused tests previously passed 22/22 and were not repeated on the unchanged candidate. `npm run lint` passed; `npm run format:check` and explicit Prettier checks for the untracked plan/test plus four formatted client files passed. Stress, build coverage from stress, Compose build, and manual proof remain pending.

- Proof update (2026-11-11): the single required `npm run test:summary:all:stress` prebuild passed client, server, main Compose, and e2e Compose builds; client build reported one bundle-size warning. Stress harness totals: client 1,169/1,169 passed; Cucumber 138/138 passed; E2E 97/97 passed; server unit 3,202 total, 3,195 passed, 4 failed, 3 skipped. Skips were the opt-in Codex native proof (`CODEINFO_NATIVE_FORK_PROOF` unset), Copilot native proof (`CODEINFO_NATIVE_COPILOT_FORK_PROOF` unset), and replica-set proof (`CODEINFO_FORK_MONGO_PROOF_URI` unset). The failures are three stale SDK version assertions (`0.162.1` expected against package `0.167.1`) and one stable-version guard success assertion. This full-suite step remains blocked pending coder repair; no rerun was performed. The wrapper removed its `codeinfo2-e2e` and `codeinfo2-cucumber` test resources; protected `codeinfo2-local` remains running. Manual proof remains pending.

- Full-stress repair handoff (2026-11-11): source and the four cited failure blocks confirm the guard still required 0.162.1 while the paired SDK manifest is 0.167.1. The guard pin and higher-stable unit fixture are repaired; the startup caller and existing integration tests consume the shared constant without further changes. No builds, tests, typechecks, lint, formatting, runtime, or Copilot calls were executed during this repair. The final full-stress checkbox remains unchecked pending focused guard/integration verification and the mandatory full rerun on the changed candidate.

- Repair-candidate proof (2026-11-11): focused guard and integration checks passed 107/107; `npm run lint`, `npm run format:check`, and explicit plan/new-test Prettier checks passed. The pinned Codex SDK and CLI remain installed at 0.167.1. Full stress on this changed candidate is next; main-stack proof remains pending.

- Final automated proof (2026-11-11): after the guard pin and higher-stable fixture repair, focused guard/integration tests passed 107/107; lint and formatting checks passed. Exactly one `npm run test:summary:all:stress` then passed on this candidate: client 1,169/1,169; server unit 3,202 total, 3,199 passed, 0 failed, 3 opt-in proof skips; Cucumber 138/138; E2E 97/97. The skipped proofs require authenticated native Codex, authenticated Copilot, or a supplied replica-set URI; all corresponding proof gates were intentionally unset. Client/server builds and main/E2E Compose builds passed; client build retained one bundle-size warning. The wrapper removed both test projects and their scoped resources. Main-stack manual proof and its shutdown remain pending.

- Main proof setup (2026-11-11): verified the stopped repository-owned `codeinfo2` main project and started it with `npm run compose:up`; all seven services are running, health checks are healthy where defined, server `/health` reports HTTP 200 with Mongo connected, and client port 5001 returns HTTP 200. Inside the running server, `codex --version` and workspace `@openai/codex`/`@openai/codex-sdk` are 0.167.1; the startup guard log records installed/required 0.167.1 and `decision=accepted`. Runtime `Codex_model_list` includes Terra. The mounted manual catalog configs for coding, manual testing, planning, review, tasking, and research med select `gpt-6.1-terra` at high reasoning and `never` approval; research lite selects Luna/high/never, research max Astra/high/never, and the legacy research agent Sol/high/never. The mounted research prompt routes ordinary targeted work lite → med → research and reserves max for completely stuck last resort. No agent discovery API was called because its current path seeds auth files. Read-only conversation summary pages 1–10 (1,000 entries) yielded no Codex conversation with a clearly identified TEST title; no conversation ID or native thread ID could be selected safely, and no turns/messages were fetched. Main-stack runtime is left running. Manual/browser/model proof and final shutdown remain pending; next proof phase needs a safe baseline conversation identity.

- Manual UI attempt (2026-11-11): the one-off Playwright proof passed the Codex Terra/high-reasoning metadata and picker UI checks and saved two screenshots, then failed before any model action while looking for the exact `coding_agent` option; report: `/tmp/codeinfo2-manual-work-0000053-proof-BSMrKf/acceptance.json`. No model runs or forks started and no cleanup action was needed. Manual proof and main-stack shutdown remain unchecked. The current selector renders each option with `agent.name` as its primary text (`AgentsComposerPanel.tsx:504-535`), while the script scopes an exact role-option lookup to the selector popover (`/tmp/codeinfo2-manual-work-0000053-proof.mjs:120-127,317`). Existing E2E coverage checks the selector popover visibility and selects generic command options (`e2e/agents.spec.ts:285-320`), while fork-target selection uses an exact option name (`e2e/agent-fork.spec.ts:148-155`). Static evidence does not establish why the runtime option was unavailable; distinguish locator mismatch from an actual UI/catalog issue before retrying. No model action was issued.

- Manual UI retry (2026-11-11): Terra/high-reasoning controls and the corrected visible-text agent option selection passed. The first coding-agent send then timed out after 180 seconds waiting for the `/agents/coding_agent/run` response (`/tmp/codeinfo2-manual-work-0000053-proof-oagGOc/acceptance.json`; proof script `/tmp/codeinfo2-manual-work-0000053-proof.mjs:134,154,318`). The report contains no accepted run or fork records and no cleanup actions. Because the browser click was issued before the response timeout, acceptance/model execution and any resulting inflight state are unknown; do not treat this as zero model calls. No further calls were made. Manual proof and main-stack shutdown remain unchecked pending parent review of this timeout and safe baseline proof.

- Main-stack manual proof (2026-11-11): the repaired one-off UI proof completed all core cases: Terra/high controls and model selection; coding agent source and later marker runs; selected older native fork to `research_agent_med`; single automatic child handover and acknowledgement; duplicate fork request idempotency; child reopen/context recall; fork of fork; zero tools; no forbidden provider requests; and unchanged scoped source fingerprint. Five allowed gzip or plain POST actions were forwarded to the main API; all owned runs settled and were retained. Both child replies were `Acknowledged.` with zero tools. Report: `/tmp/codeinfo2-manual-work-0000053-proof-9bCsO8/acceptance.json`; screenshots are listed there. The expected missing-baseline result was partial, then the separate authorized baseline-only proof accepted and settled one OpenAI Codex `gpt-6.1-sol` action on conversation `02d81230-4369-4604-bfc9-1446bd0c3fab`. It retained the existing metadata thread `01a1c7df-519a-7a83-aab2-346c6f965b35`, model, and provider and persisted the exact new acknowledgement with zero tools, but proof stopped at an assertion requiring `reply.native.sessionId` to equal that thread; the persisted reply has no `native` object (`/tmp/codeinfo2-manual-work-0000053-baseline-proof-bV39Ab/acceptance.json`, script line 234). Read-only API confirmation found no inflight run, and the original turns were not changed. This does not establish whether the absent reply field is a serialization behavior or a proof assumption. Manual proof remains incomplete pending parent review; leave the main stack running and do not repeat any model actions.

- Baseline contract review (2026-11-11): the saved-identity baseline run passed its checks through the exact one-turn acknowledgement assertion before failing at proof-script line 234. It verified the prior short Codex chat and flags/thread ID; opened the existing `/chat?conversationId=...` UI with Codex selected; sent one allowed POST with the saved conversation/provider/model; received HTTP 202; observed terminal persistence and no inflight run; verified old turns unchanged, exactly one new user and assistant turn, provider/model/status preserved, zero tools, and exact acknowledgement text. The new assistant turn has no `native` object. The script did not reach its subsequent full metadata identity comparison, WebSocket tool-frame assertion, visible-reply/reopen checks, or final success record. The separately read current summary confirms provider `codex`, model `gpt-6.1-sol`, and the pre-existing `flags.threadId`; no migration or data repair occurred. Source contract evidence: `/chat` passes the active saved `threadId` into `chat.run` but does not set `disableSystemContext` (`server/src/routes/chat.ts:1596-1618`); Codex emits a bare completion with `threadId` when that option is false, and reads/emits optional `native` turn metadata only for the deferred `disableSystemContext` path (`server/src/chat/interfaces/ChatInterfaceCodex.ts:863-884`). `ChatInterface` persists only the optional `event.native` field (`server/src/chat/interfaces/ChatInterface.ts:221-227,395-400,546-562`). The agent service explicitly sets `disableSystemContext: true` (`server/src/agents/service.ts:3437-3449,3481-3486`), so native turn capture is implemented on that agent path; normal `/chat` source does not promise `reply.native`. The existing `/chat` resume regression checks resumption from saved conversation flags, not a per-turn native object (`server/src/test/integration/chat-codex.test.ts:1829-1888`). Manual proof and shutdown remain unchecked pending parent disposition of the baseline proof contract. Main stack remains running.

- Completed manual proof (2026-11-11): the already recorded main UI proof passed its five allowed Codex Terra actions and all scoped acceptance cases (report `/tmp/codeinfo2-manual-work-0000053-proof-9bCsO8/acceptance.json`; no success output/log reopened). The separate one-turn baseline acknowledgement was accepted and persisted once on existing conversation `02d81230-4369-4604-bfc9-1446bd0c3fab`, preserving Codex `gpt-6.1-sol` and flags thread `01a1c7df-519a-7a83-aab2-346c6f965b35`; old turn IDs remained unchanged and the new reply had zero tools. The read-only finalizer proved the existing ACK without resending; `thread/read` and `thread/turns/list` on the matching OpenAI native thread found the unique completed proof turn `01a1c881-d375-70f1-89ed-df86c256b7f6`, matching the persisted ACK and original greeting/ACK, with no native tool items and graceful RPC closure. Its isolated UI reopen displayed the saved model and existing ACK; no new model requests were made. Finalizer report: `/tmp/codeinfo2-manual-work-0000053-baseline-evidence-P1fajt/acceptance.json`; screenshot: `/tmp/codeinfo2-manual-work-0000053-baseline-evidence-P1fajt/existing-baseline-reopened-own-ack.png`. Limitation: the original failed proof artifact did not retain pre-send hashes/IDs for the two original records; its original-record comparison passed before the unrelated optional-native assertion, and finalizer verified the original greeting reply against native history and preserved all current records/flags across read-only queries/reopen. Manual proof is complete; main-stack shutdown is complete.

- Main-stack shutdown (2026-11-11): after manual proof, `npm run compose:down` exited successfully and removed the repository-owned `codeinfo2` main containers/network without volume deletion flags. A labeled `docker ps -a` query found no remaining `codeinfo2` containers. The protected `codeinfo2-local` project remains running with all seven containers up and healthy where health checks are defined. Both projects’ named volumes remain present. Task 4 proof and shutdown are complete.

- Final staged pre-commit gate (2026-11-11): branch is `manual_work/0000053-codex-terra-and-agent-fork-upgrade`; staged tree was `d467e9571dba99e9dc1f966513dee747c59cb239` before and after the failed hook. Sequential Git verification with `GIT_OPTIONAL_LOCKS=0` confirmed the index restored, no unstaged diff, and no unexpected untracked files. The required `git diff --cached --check` passed. `npx lint-staged` ran root-configured `eslint --ext .ts,.tsx --max-warnings=0` successfully, then `prettier --check` failed on 12 staged server files: `server/src/agents/forkService.ts`, `server/src/config/codexConfig.ts`, `server/src/test/integration/agent-fork-codex-native.test.ts`, `server/src/test/integration/agent-fork-mongo.test.ts`, `server/src/test/unit/agent-fork-native.test.ts`, `server/src/test/unit/agent-fork-router.test.ts`, `server/src/test/unit/agent-fork-service.test.ts`, `server/src/test/unit/agents-config-defaults.test.ts`, `server/src/test/unit/chatModels.codex.test.ts`, `server/src/test/unit/codexConfig.test.ts`, `server/src/test/unit/codexEnvDefaults.test.ts`, and `server/src/test/unit/open-code-review-flow.test.ts`. No source was modified. Stdout-only Prettier references and unified patch are in `/tmp/codeinfo2-precommit-format-reference-0000053/12-server-files.patch`, generated from repository-root cwd using `.prettierrc` and root `.prettierignore`, matching lint-staged’s root invocation. Neither the root nor server ignore patterns exclude these paths. Root `format:check` uses tracked files and Prettier with `--ignore-unknown`; this config does not explain the earlier reported pass for the same tracked files, and whether their contents differed then is unresolved. The formatting checkbox is pending coder format-only repair; previous final-stress and completed live proof evidence remains recorded and unchanged.

- Formatted-candidate gates (2026-11-11): on staged tree `7c3c37046cd13220faab7cdaab6dbf64be3e74c9`, branch `manual_work/0000053-codex-terra-and-agent-fork-upgrade`, `git diff --cached --check`, `npx lint-staged` (ESLint and Prettier), and `npm run format:check` all passed. The 12 server files received the referenced Prettier-only formatting patch; no semantic changes were reported by coder/parent review. The full stress run is pending on this formatted candidate. Previously recorded full-stress and complete manual/native baseline evidence remain valid for the functionally identical pre-format candidate; no additional model calls were needed or made.

- Final formatted-candidate proof (2026-11-11): after the 12 server files received Prettier-only changes, the candidate passed `git diff --cached --check`, `npx lint-staged` (ESLint and Prettier), and `npm run format:check`. Exactly one `env -u CODEINFO_NATIVE_FORK_PROOF -u CODEINFO_NATIVE_COPILOT_FORK_PROOF -u CODEINFO_NATIVE_CODEX_FORK_PROOF -u CODEINFO_FORK_MONGO_PROOF_URI E2E_USE_MOCK_CHAT=true npm run test:summary:all:stress` then passed: client 1,169/1,169; server unit 3,202 total, 3,199 passed, 0 failed, 3 opt-in skips; Cucumber 138/138; E2E 97/97. The skips were the opt-in native Codex, native Copilot, and replica-set proofs, whose gates were unset. Client/server builds and main/E2E Compose builds passed; client build emitted one warning. Successful logs were not opened. Harness log paths: `test-results/client-tests-2026-11-11T03-36-29-886Z.log`, `test-results/server-unit-tests-2026-11-11T03-36-29-887Z.log`, `test-results/server-cucumber-tests-2026-11-11T03-36-29-889Z.log`, `logs/test-summaries/e2e-tests-2026-11-11T03-36-29-890Z.log`; build summaries: `logs/test-summaries/build-client-latest.log`, `logs/test-summaries/build-server-latest.log`, `logs/test-summaries/compose-build-latest.log`, and `logs/test-summaries/compose-e2e-build-latest.log`. Functional/manual/native baseline proof was completed on the functionally identical pre-format candidate; only the reviewed 12-file formatting patch differed, with no further model calls. Task 4 automated and manual proof is complete.
