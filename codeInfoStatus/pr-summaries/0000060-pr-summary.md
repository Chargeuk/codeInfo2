# Story 0000060 PR Summary

- Plan: `planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md`
- Repository scope: current repository only
- Active review pass: `0000060-20260628T052129Z-3b5caa68`
- Active review cycle: `0000060-rc-20260628T060453Z-138f52f8`
- Active task-up repair owners: `Task 20. Restore Supported Main-Stack Review-Agent Availability For The Opt-In Review Flow`, `Task 21. Bound GitHub Review Ingest Materialization Without Changing Review Semantics`
- Active final revalidation owner: `Task 22. Revalidate review pass 0000060-20260628T052129Z-3b5caa68 after review-cycle 0000060-rc-20260628T060453Z-138f52f8 task-up repairs`
- Planned durable manual proof bundle: `codeInfoStatus/manual-proof/0000060/`

## Comparison Context

1. Story 60 adds a flow-only GitHub PR review-cycle surface instead of a second agent-command contract. The runtime supports authored `if` branching, shared AI-or-script decisions for `if` and loop-control steps, persisted `wait` in whole seconds, and thin `github_open_pr`, `github_fetch_reviews`, and `github_close_pr` flow steps.
2. The shipped workflow wiring remains opt-in. `flows/implement_next_plan.json` stays the preserved default implementation path, while `flows/implement_next_plan_github_review.json` is the copied variant that opens a PR, waits, fetches outside review feedback, filters reviewer-only comments, classifies valid findings, leaves clean-cycle PRs open, and closes findings-present PRs only before the existing repair loopback paths.
3. Task 20 repaired the supported main-stack catalog seam so the checked-in opt-in GitHub review flow can resolve a runnable `review_agent` home from the repository-owned mounted catalog without mutating the default `implement_next_plan` entrypoint.
4. Task 21 repaired the bounded-ingest seam so one execution now publishes a bounded normalized review corpus before execution-scoped scratch persistence and downstream markdown materialization.
5. Task 22 owns closeout proof only. The current implementation work is to refresh this traceability map before wrappers execute so later failures can be classified honestly as baseline-stack issues or story-owned regressions.

## Repaired Seams

### Task 20 Supported-Stack Reachability

- Reproduced supported-stack defect: on the checked-in main stack from `docker-compose.yml`, `implement_next_plan_github_review` stayed unreachable because the mounted repository-owned catalog at `manual_testing/codeinfo_agents` omitted `review_agent`, even though the shipped opt-in flow legitimately requires that agent for its review-disposition loop.
- Chosen owning repair seam: mounted catalog content, not flow rewiring and not another discovery redesign.
- Exact file set changed for Task 20:
  - `manual_testing/codeinfo_agents/review_agent/**`
  - `server/src/test/integration/flows.list.test.ts`
  - `codeInfoStatus/pr-summaries/0000060-pr-summary.md`
- Boundaries that stay unchanged:
  - no mutation of the default `implement_next_plan` flow
  - no broader agent-home compatibility redesign
  - no new browser-visible selection behavior beyond restoring the shipped opt-in variant as runnable when the mounted review-capable catalog is present

### Task 21 Bounded Review Ingest

- Reproduced boundedness defect: `fetchPullRequestReviews(...)` kept GitHub CLI pagination intact but returned every normalized review submission and inline review comment, `writeGitHubReviewScratch(...)` persisted that full normalized corpus under `codeInfoTmp/reviews`, `readGitHubReviewScratch(...)` reread the same execution-scoped handoff, and `buildGitHubExternalReviewInputMarkdown(...)` expanded the reread artifact into one downstream markdown prompt input without any explicit corpus cap.
- Chosen owning repair seam: producer-side bounding inside `fetchPullRequestReviews(...)`, so one bounded normalized corpus becomes authoritative before `writeGitHubReviewScratch(...)` writes the execution-scoped artifact, `readGitHubReviewScratch(...)` rereads it, and `materializeGitHubExternalReviewInput(...)` plus `buildGitHubExternalReviewInputMarkdown(...)` consume it.
- Preserved semantics that stay unchanged:
  - GitHub CLI pagination still runs through `gh api --paginate --slurp`
  - both review submissions and inline review comments remain in scope
  - execution-scoped scratch ownership and foreign-selector rejection still fail closed
  - `runGitHubFetchReviewsStep(...)` keeps the same write -> reread -> materialize ordering and does not invent a second cleanup contract
  - Story 60 cleanup ownership stays rooted at `buildGitHubReviewScratchPaths(...).reviewsRoot` under `codeInfoTmp/reviews`
- Chosen corpus rule for Task 21:
  - keep the newest `200` normalized review submissions per execution
  - keep the newest `200` normalized inline review comments per execution
  - preserve original survivor ordering after truncation so downstream filtering and markdown materialization continue to read one deterministic bounded corpus rather than a second reordered policy view

## Focused Proof Map

### Supported-Stack Reachability

- Proof surface: `server/src/test/integration/flows.list.test.ts`
  - Expected focused cases:
    - `supported main-stack catalog exposes the Story 60 GitHub review variant as runnable when review_agent is available`
    - `ingested Story 60 GitHub review variant is disabled when review_agent is only missing inside a nested branch`
  - Current focused result source: `PASSED IN TASK 20 FOCUSED PROOF`
  - Baseline-versus-story note: if proof fails before the repaired catalog seam is exercised, such as unreadable mounted catalogs or broken fixture runtime wiring, classify that as baseline or harness drift rather than a reopened Story 60 regression.
- Proof surface: `client/src/test/flowsPage.runGuard.test.tsx`
  - Expected focused case:
    - `keeps the active runnable selection when an ingested GitHub review variant is disabled from list data`
  - Current focused result source: `PASSED IN TASK 20 FOCUSED PROOF`
  - Baseline-versus-story note: failures caused by generic test harness rendering, network mocking, or unrelated list bootstrapping are baseline or harness issues unless the run reaches the stale-disabled-selection contract and that repaired behavior regresses.
- Proof surface: `e2e/flows-execution-runs.spec.ts`
  - Expected focused case:
    - `flows let operators select the GitHub review variant without mutating the default entrypoint`
  - Current focused result source: `PASSED IN TASK 20 FOCUSED PROOF`
  - Baseline-versus-story note: browser-launch, stack-start, or shared environment failures are baseline until the run reaches the repaired `/flows` launcher seam.

### Bounded Review Ingest

- Proof surface: `server/src/test/unit/flows.github-adapter.test.ts`
  - Expected focused cases:
    - `review fetch preserves paginated review submissions and inline review comments`
    - `review fetch publishes one bounded producer corpus after paginated normalization`
  - Current focused result source: `PASSED IN TASK 21 FOCUSED PROOF`
  - Baseline-versus-story note: failures in generic unit-wrapper bootstrap are baseline or harness issues unless the run reaches paginated normalization or bounded producer-corpus assertions and those repaired semantics regress.
- Proof surface: `server/src/test/integration/flows.run.loop.test.ts`
  - Expected focused case:
    - `github review materialization replaces stale scratch with fresh bounded reviewer feedback before classification`
  - Current focused result source: `PASSED IN TASK 21 FOCUSED PROOF`
  - Baseline-versus-story note: failures before execution-scoped scratch write -> reread -> materialize ordering is exercised are baseline or harness issues unless the repaired bounded stale-to-fresh seam itself regresses.

## Supported Runtime Handoff

- Supported runtime stack: `docker-compose.yml`
- Compose-owned env-file contract:
  - `server/.env`
  - `server/.env.local`
  - `client/.env`
  - `client/.env.local`
- Mounted agent namespace:
  - `manual_testing/codeinfo_agents`
  - `manual_testing/codex_agents`
- Main ports:
  - client `5001`
  - server `5010`
- Supported readiness checks:
  - server `http://localhost:5010/health`
  - client `http://localhost:5001`
- Automated proof owner for the default supported main-stack path:
  - `npm run test:summary:host-network:main`

## Broad Rerun Ownership

- Container and build wrappers owned by Task 22:
  - `npm run compose:build:summary`
  - `npm run build:summary:server`
  - `npm run build:summary:client`
- Focused revalidation reruns owned by Task 22:
  - `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts`
  - `npm run test:summary:client -- --file client/src/test/flowsPage.runGuard.test.tsx --test-name "keeps the active runnable selection when an ingested GitHub review variant is disabled from list data"`
  - `npm run test:summary:e2e -- --file e2e/flows-execution-runs.spec.ts --grep "flows let operators select the GitHub review variant without mutating the default entrypoint"`
  - `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts`
  - `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts`
- Broad wrapper reruns owned by Task 22:
  - `npm run test:summary:server:unit`
  - `npm run test:summary:server:cucumber`
  - `npm run test:summary:client`
  - `npm run test:summary:e2e`
  - `npm run compose:up`
  - `npm run test:summary:host-network:main`
  - `npm run compose:down`
  - `npm run lint`
  - `npm run format:check`

## Prefilled Traceability Slots

- `npm run compose:build:summary`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: Docker cache, registry, or unrelated container build failures are baseline until the repaired supported-stack runtime contract is actually exercised.
- `npm run build:summary:server`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: compile failures outside the repaired Task 20 or Task 21 seams are baseline build drift unless the changed server-owned runtime or bounded-ingest paths are the failing locus.
- `npm run build:summary:client`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: generic typecheck or bundle failures are baseline unless they directly break the repaired `/flows` reachability or disabled-selection surfaces.
- `npm run test:summary:server:unit`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: unrelated server-unit regressions are baseline for this closeout unless they rebreak the supported-stack reachability or bounded-ingest contracts.
- `npm run test:summary:server:cucumber`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: authored flow-execution failures outside the repaired review-flow seams are baseline or neighboring-surface regressions until they specifically intersect the Story 60 repaired contracts.
- `npm run test:summary:client`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: unrelated client-surface failures are baseline unless they directly rebreak the repaired `/flows` selection or reachability contract.
- `npm run test:summary:e2e`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: browser or stack startup failures are baseline until the repaired Story 60 launcher surface is reached.
- `npm run compose:up`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: stack boot, mount, or env-file failures are baseline unless the stack comes up and then the repaired supported-runtime contract itself fails.
- `npm run test:summary:host-network:main`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: host-network startup, readiness, mount, or connectivity failures are baseline until the supported main-stack proof reaches the repaired runtime seams.
- `npm run compose:down`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: teardown issues are baseline cleanup drift unless they hide a story-owned runtime failure already observed earlier in the same proof sequence.
- `npm run lint`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: lint failures outside the repaired files are baseline repository drift unless they were introduced by the Task 20 or Task 21 repair surfaces.
- `npm run format:check`
  - Expected result slot: `PENDING TASK 22 BROAD PROOF`
  - Baseline-versus-story note: formatting failures outside the repaired files are baseline repository drift unless they were introduced by the Task 20 or Task 21 repair surfaces.

## Baseline Adjudication

- Shared runtime surfaces to read before and during broad proof:
  - `docker-compose.yml`
  - wrapper scripts in `package.json`: `compose:build:summary`, `build:summary:server`, `build:summary:client`, `test:summary:server:unit`, `test:summary:server:cucumber`, `test:summary:client`, `test:summary:e2e`, `test:summary:host-network:main`, `compose:up`, `compose:down`, `lint`, `format:check`
  - readiness at `http://localhost:5010/health`
  - UI reachability at `http://localhost:5001`
  - mounted `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` catalogs
- Repository-owned baseline checks completed before wrapper execution:
  - `docker-compose.yml` is present and still declares server port `5010`, client port `5001`, and health probes for both services.
  - `package.json` still exposes every wrapper Task 22 depends on, including `test:summary:server:cucumber`.
  - `server/.env`, `server/.env.local`, `client/.env`, and `client/.env.local` are all present for the supported stack contract.
  - The repository-owned `manual_testing` catalog roots remain the supported main-stack catalog contract for later proof.
- If a broad rerun reports a broken mount, port binding, readiness probe, wrapper wording seam, or provider-auth problem before the repaired seams are reached, record it as `BASELINE FAILURE` or `HARNESS FAILURE` rather than as a reopened Story 60 regression.

## State Alignment

- The plan and `codeInfoStatus/flow-state/review-disposition-state.json` still agree on review pass `0000060-20260628T052129Z-3b5caa68`, review cycle `0000060-rc-20260628T060453Z-138f52f8`, the same final revalidation title, and this repository as the only proof scope.
- The review-disposition file still shows Task 20 and Task 21 findings as unresolved and still points at review-time repository head `3b5caa68...`; treat that as historical review routing context until Task 22’s broad proof closes the cycle on current `HEAD`.
- No second final-owner wording should remain after Task 22 closeout work completes.

## Manual Proof Notes

- Optional later live proof should use the checked-in main stack via `npm run compose:build`, then `npm run compose:up`, with health confirmed at `http://localhost:5010/health` and the normal client at `http://localhost:5001`.
- Use a dedicated sandbox worked repository on the Story 60 branch under the host ingest root configured by `CODEINFO_HOST_INGEST_DIR`, and place `CODEINFO_PR_TOKEN` only in that worked repository `.env.local`.
- If later manual proof needs screenshots, stage them under `/tmp/playwright-output/0000060-review-cycle-final/...`, then retrieve them from `$CODEINFO_ROOT/playwright-output-local/0000060-review-cycle-final/...` and transfer the retained artifacts into `codeInfoTmp/manual-testing/0000060/22/`.
