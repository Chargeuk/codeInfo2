# Blind-spot challenge

Reviewed range: `00ced5bb15524d12395dfc5c0d427b3c65eb7f97` -> `d666d0a0e6f3f33957fec56d228061eee18e3a8d`

## Confirmed finding

- `server/src/flows/service.ts:8165-8205` leaves the conversation lock held when `persistFreshRunRetryOwnershipCompletion(...)` fails twice on a successful fresh-run retry replay. The code sets `retryCompletionDurable = false`, skips both `releaseConversationLockFn(...)` and `clearFreshRunRetryOwnership(...)`, but still calls `rememberFreshRunRetryOwnershipCompletion(...)`. That means a terminal metadata write failure can strand the conversation lock while also advertising the run as completed in memory. The existing test at `server/src/test/integration/flows.run.errors.test.ts:2409-2435` only exercises one injected failure followed by success, so the double-failure cleanup path remains unproven.

## Challenged blind spots

- I reopened the new review-cycle and target-building paths in `server/src/flows/reviewCycleLifecycle.ts`, `server/src/flows/reviewTargets.ts`, and `server/src/flows/reviewBatchWorkspace.ts`. I did not find a second concrete regression with matching code evidence.
- The scheduler-provided input bundle is missing the contract-required `input/job.md` referenced by `codeinfo_markdown/review_job_workspace_contract.md`. That is a review-input coverage gap, not a code defect, but it leaves some job-specific metadata unverified.

## Residual risk

- The review evidence stage did not rerun the full client/server/Cucumber/e2e suite, Compose lifecycle, or native Codex launcher. That keeps runtime and integration confidence below the story acceptance bar even though the plan task is already marked complete.
