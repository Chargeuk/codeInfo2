# Story 0000060 PR Summary

- Plan: `planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md`
- Repository scope: current repository only
- Active review pass: `0000060-20260628T052129Z-3b5caa68`
- Active review cycle: `0000060-rc-20260628T060453Z-138f52f8`
- Active repair owner: `Task 20. Restore Supported Main-Stack Review-Agent Availability For The Opt-In Review Flow`
- Final revalidation owner: `Task 22. Revalidate review pass 0000060-20260628T052129Z-3b5caa68 after review-cycle 0000060-rc-20260628T060453Z-138f52f8 task-up repairs`
- Planned durable manual proof bundle: `codeInfoStatus/manual-proof/0000060/`

## Final Summary

1. Story 60 adds a flow-only GitHub PR review-cycle surface instead of a second agent-command contract. The runtime supports authored `if` branching, shared AI-or-script decisions for `if` and loop-control steps, persisted `wait` in whole seconds, and thin `github_open_pr`, `github_fetch_reviews`, and `github_close_pr` flow steps.
2. The shipped workflow wiring remains opt-in. `flows/implement_next_plan.json` stays the preserved default implementation path, while `flows/implement_next_plan_github_review.json` is the copied variant that opens a PR, waits, fetches outside review feedback, filters reviewer-only comments, classifies valid findings, leaves clean-cycle PRs open, and closes findings-present PRs only before the existing repair loopback paths.
3. Review-created Task 18 repaired discovery ownership so `/flows` can correctly classify the Story 60 GitHub review variant against repository-owned agent homes, but the checked-in supported main stack still does not mount a runnable `review_agent` home for that variant.
4. The active repair task is Task 20 for review cycle `0000060-rc-20260628T060453Z-138f52f8`. This cycle now has two serious findings only: restore supported main-stack review-agent reachability for the opt-in flow, then bound GitHub review ingest materialization before Task 22 runs the broad final revalidation.

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

- The plan and `codeInfoStatus/flow-state/review-disposition-state.json` agree on review pass `0000060-20260628T052129Z-3b5caa68`, review cycle `0000060-rc-20260628T060453Z-138f52f8`, unresolved findings `plan_contract_issue` and `generic_engineering_issue`, Task 20 as the active supported-stack repair owner, and Task 22 as the single final revalidation owner for this active cycle.
- No second final-owner wording should remain after Task 22 closeout work completes.

## Manual Proof Notes

- Optional later live proof should use the checked-in main stack via `npm run compose:build`, then `npm run compose:up`, with health confirmed at `http://localhost:5010/health` and the normal client at `http://localhost:5001`.
- Use a dedicated sandbox worked repository on the Story 60 branch under the host ingest root configured by `CODEINFO_HOST_INGEST_DIR`, and place `CODEINFO_PR_TOKEN` only in that worked repository `.env.local`.
- If later manual proof needs screenshots, stage them under `/tmp/playwright-output/0000060-review-cycle-final/...`, then retrieve them from `$CODEINFO_ROOT/playwright-output-local/0000060-review-cycle-final/...` and transfer the retained artifacts into `codeInfoTmp/manual-testing/0000060/22/`.
