# Story 0000060 PR Summary

- Plan: `planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md`
- Repository scope: current repository only
- Active review pass: `0000060-20260628T052129Z-3b5caa68`
- Active review cycle: `0000060-rc-20260628T060453Z-138f52f8`
- Active repair owner: `Task 21. Bound GitHub Review Ingest Materialization Without Changing Review Semantics`
- Final revalidation owner: `Task 22. Revalidate review pass 0000060-20260628T052129Z-3b5caa68 after review-cycle 0000060-rc-20260628T060453Z-138f52f8 task-up repairs`
- Planned durable manual proof bundle: `codeInfoStatus/manual-proof/0000060/`

## Final Summary

1. Story 60 adds a flow-only GitHub PR review-cycle surface instead of a second agent-command contract. The runtime supports authored `if` branching, shared AI-or-script decisions for `if` and loop-control steps, persisted `wait` in whole seconds, and thin `github_open_pr`, `github_fetch_reviews`, and `github_close_pr` flow steps.
2. The shipped workflow wiring remains opt-in. `flows/implement_next_plan.json` stays the preserved default implementation path, while `flows/implement_next_plan_github_review.json` is the copied variant that opens a PR, waits, fetches outside review feedback, filters reviewer-only comments, classifies valid findings, leaves clean-cycle PRs open, and closes findings-present PRs only before the existing repair loopback paths.
3. Review-created Task 20 repaired the supported main-stack catalog seam so the checked-in opt-in GitHub review flow can now resolve a runnable `review_agent` home from the repository-owned mounted catalog without mutating the default `implement_next_plan` entrypoint.
4. The active repair task is now Task 21 for review cycle `0000060-rc-20260628T060453Z-138f52f8`. The remaining serious finding is the unbounded GitHub review-ingest seam: one execution currently fetches a full paginated review corpus, writes that full normalized corpus into execution-scoped scratch JSON, and then materializes one downstream markdown derivative from the same unbounded scratch before Task 22 runs the broad final revalidation.

## Task 20 Decision Note

- Reproduced supported-stack defect: on the checked-in main stack from `docker-compose.yml`, `implement_next_plan_github_review` stays unreachable because the mounted repository-owned catalog at `manual_testing/codeinfo_agents` omits `review_agent`, even though the shipped opt-in flow still legitimately requires that agent for its review-disposition loop.
- Chosen owning repair seam: mounted catalog content, not flow rewiring and not another discovery redesign.
- Exact file set chosen for this repair:
  - `manual_testing/codeinfo_agents/review_agent/**`
  - `server/src/test/integration/flows.list.test.ts`
  - `codeInfoStatus/pr-summaries/0000060-pr-summary.md`
- Authoritative runtime contract that stays unchanged:
  - `docker-compose.yml`
  - `server/.env`
  - `server/.env.local`
  - `manual_testing/codeinfo_agents`
  - `manual_testing/codex_agents`
- Boundaries that must not change:
  - no mutation of the default `implement_next_plan` flow
  - no broader agent-home compatibility redesign
  - no new browser-visible selection behavior beyond restoring the shipped opt-in variant as runnable when the mounted review-capable catalog is present

## Task 21 Decision Note

- Reproduced boundedness defect: `fetchPullRequestReviews(...)` currently keeps GitHub CLI pagination intact but returns every normalized review submission and inline review comment, `writeGitHubReviewScratch(...)` persists that full normalized corpus under `codeInfoTmp/reviews`, `readGitHubReviewScratch(...)` rereads the same execution-scoped handoff, and `buildGitHubExternalReviewInputMarkdown(...)` expands the reread artifact into one downstream markdown prompt input without any explicit corpus cap.
- Chosen owning repair seam: producer-side bounding inside `fetchPullRequestReviews(...)`, so one bounded normalized corpus becomes authoritative before `writeGitHubReviewScratch(...)` writes the execution-scoped artifact, `readGitHubReviewScratch(...)` rereads it, and `materializeGitHubExternalReviewInput(...)` plus `buildGitHubExternalReviewInputMarkdown(...)` consume it.
- Preserved semantics that must stay unchanged:
  - GitHub CLI pagination still runs through `gh api --paginate --slurp`
  - both review submissions and inline review comments remain in scope
  - execution-scoped scratch ownership and foreign-selector rejection still fail closed
  - `runGitHubFetchReviewsStep(...)` keeps the same write -> reread -> materialize ordering and does not invent a second cleanup contract
  - Story 60 cleanup ownership stays rooted at `buildGitHubReviewScratchPaths(...).reviewsRoot` under `codeInfoTmp/reviews`
- Chosen corpus rule for Task 21:
  - keep the newest `200` normalized review submissions per execution
  - keep the newest `200` normalized inline review comments per execution
  - preserve original survivor ordering after truncation so downstream filtering and markdown materialization continue to read one deterministic bounded corpus rather than a second reordered policy view

## Task-Required Findings Checklist

- Finding `plan_contract_issue`
  Requirement `supported main-stack catalog exposes the Story 60 GitHub review variant as runnable when review_agent is available`
  Focused proof owner: `server/src/test/integration/flows.list.test.ts`
  Pending focused result slot: `PASSED IN TASK 20 FOCUSED PROOF`
  Requirement `the preserved negative catalog boundary stays disabled only when review_agent is genuinely missing from the selected catalog seam`
  Focused proof owner: `server/src/test/integration/flows.list.test.ts`
  Pending focused result slot: `PASSED IN TASK 20 FOCUSED PROOF`
  Requirement `the normal /flows launcher path can still select the GitHub review variant without mutating the default implement_next_plan entrypoint`
  Focused proof owner: `e2e/flows-execution-runs.spec.ts`
  Pending focused result slot: `PASSED IN TASK 20 FOCUSED PROOF`
- Preserved mixed-state `/flows` selection contract
  Focused proof owner: `client/src/test/flowsPage.runGuard.test.tsx`
  Pending focused result slot: `PASSED IN TASK 20 FOCUSED PROOF`
  Requirement `the hidden disabled GitHub-review option remains only as disabled local state and launch submissions exclude the stale value`
  Broad revalidation surfaces: focused `client/src/test/flowsPage.runGuard.test.tsx`, full `npm run test:summary:client`, full `npm run test:summary:e2e`
- Finding `generic_engineering_issue`
  Requirement `the GitHub review adapter keeps paginated review submissions and inline comments in scope while publishing one bounded producer corpus before execution-scoped scratch write`
  Focused proof owners: `server/src/test/unit/flows.github-adapter.test.ts`
  Pending focused result slot: `PASSED IN TASK 21 FOCUSED PROOF`
  Requirement `fresh bounded execution-scoped scratch replaces stale review content before markdown materialization and downstream classification reads that execution's review corpus`
  Focused proof owner: `server/src/test/integration/flows.run.loop.test.ts`
  Pending focused result slot: `PASSED IN TASK 21 FOCUSED PROOF`

## Baseline Adjudication

- Shared runtime surfaces to read before and during broad proof:
  - `docker-compose.yml`
  - wrapper scripts in `package.json`: `compose:build:summary`, `build:summary:server`, `build:summary:client`, `test:summary:server:unit`, `test:summary:client`, `test:summary:e2e`, `test:summary:host-network:main`, `compose:up`, `compose:down`, `lint`, `format:check`
  - readiness at `http://localhost:5010/health`
  - UI reachability at `http://localhost:5001`
  - mounted `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` catalogs
- Repository-owned baseline checks completed before wrapper execution:
  - `docker-compose.yml` is present and still declares server port `5010`, client port `5001`, and health probes for both services.
  - `package.json` still exposes every wrapper Task 20 and Task 22 depend on.
  - The repository-owned `manual_testing` catalog roots are still the supported main-stack catalog contract for later proof.
- If a later broad rerun reports a broken mount, port binding, readiness probe, or wrapper wording seam, record it here as `BASELINE FAILURE`, name the exact surface, and do not classify it as a Story 60 product regression unless the failure is inside the repaired supported-stack discovery or disabled-selection logic itself.
- Existing manual-proof limitation remains separate from baseline availability: if a later live rerun still lacks the repository-owned `review_agent` catalog entry at runtime, record that limitation honestly as a runtime-handoff or baseline seam rather than reopening Task 18 implementation by default.

## Traceability Slots

- Focused `plan_contract_issue` positive result slot: `PASSED IN TASK 20 FOCUSED PROOF`
- Focused `plan_contract_issue` negative result slot: `PASSED IN TASK 20 FOCUSED PROOF`
- Focused `/flows` launcher result slot for `plan_contract_issue`: `PASSED IN TASK 20 FOCUSED PROOF`
- Focused stale-selection guard result slot for the preserved disabled-selection contract: `PASSED IN TASK 20 FOCUSED PROOF`
- Broad wrapper rerun slot:
  - `compose:build:summary`: `NOT RUN IN TASK 19 YET`
  - `build:summary:server`: `NOT RUN IN TASK 19 YET`
  - `build:summary:client`: `NOT RUN IN TASK 19 YET`
  - full `test:summary:server:unit`: `NOT RUN IN TASK 19 YET`
  - full `test:summary:client`: `NOT RUN IN TASK 19 YET`
  - full `test:summary:e2e`: `NOT RUN IN TASK 19 YET`
  - `compose:up`: `NOT RUN IN TASK 19 YET`
  - `test:summary:host-network:main`: `NOT RUN IN TASK 19 YET`
  - `compose:down`: `NOT RUN IN TASK 19 YET`
  - `lint`: `NOT RUN IN TASK 19 YET`
  - `format:check`: `NOT RUN IN TASK 19 YET`
- Out-of-scope explanation slot:
  - Cucumber: `Still out of scope unless implementation broadens beyond supported-stack catalog discovery or the /flows disabled-selection guard.`
  - Helper-script unittest: `Still out of scope for this cycle because no helper-side review-count or GitHub feedback-gating seam changed in Task 18.`

## State Alignment

- The plan and `codeInfoStatus/flow-state/review-disposition-state.json` agree on review pass `0000060-20260628T052129Z-3b5caa68`, review cycle `0000060-rc-20260628T060453Z-138f52f8`, unresolved findings `plan_contract_issue` and `generic_engineering_issue`, Task 21 as the active bounded-ingest repair owner, and Task 22 as the single final revalidation owner for this active cycle.
- No second final-owner wording should remain after Task 22 closeout work completes.

## Manual Proof Notes

- Optional later live proof should use the checked-in main stack via `npm run compose:build`, then `npm run compose:up`, with health confirmed at `http://localhost:5010/health` and the normal client at `http://localhost:5001`.
- Use a dedicated sandbox worked repository on the Story 60 branch under the host ingest root configured by `CODEINFO_HOST_INGEST_DIR`, and place `CODEINFO_PR_TOKEN` only in that worked repository `.env.local`.
- If later manual proof needs screenshots, stage them under `/tmp/playwright-output/0000060-review-cycle-final/...`, then retrieve them from `$CODEINFO_ROOT/playwright-output-local/0000060-review-cycle-final/...` and transfer the retained artifacts into `codeInfoTmp/manual-testing/0000060/22/`.
