# Story 0000060 PR Summary

- Plan: `planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md`
- Repository scope: current repository only
- Planned durable manual proof bundle: `codeInfoStatus/manual-proof/0000060/`

## Final Summary

1. Story 60 adds a flow-only GitHub PR review-cycle surface instead of a second agent-command contract. The shipped runtime now supports authored `if` branching, shared AI-or-script decisions for `if` and loop-control steps, persisted `wait` in whole seconds, and thin `github_open_pr`, `github_fetch_reviews`, and `github_close_pr` flow steps.
2. The first shipped workflow wiring is opt-in only. `flows/implement_next_plan.json` stays the preserved default implementation path, while `flows/implement_next_plan_github_review.json` is the copied variant that opens a PR, waits, fetches outside review feedback, filters reviewer-only comments, classifies valid findings, leaves clean-cycle PRs open, and closes findings-present PRs only before the existing repair loopback paths.
3. GitHub transport stays intentionally narrow and repository-local. The runtime reads `CODEINFO_PR_TOKEN` only from the worked repository root `.env.local`, maps it only into `GH_TOKEN` for the child `gh` process, resolves repository plus branch plus base plus PR state explicitly, paginates review submissions and inline review comments, and keeps transient GitHub review scratch under `codeInfoTmp/reviews/` rather than reusing the older external-review ingest input path.
4. The minimum documented fine-grained GitHub token contract for this story is repository `Pull requests` permission at `write`. That single permission level covers PR open and close mutations plus review and inline-comment retrieval, while keeping the story scoped away from broader GitHub issue, label, assignee, or merge automation surfaces.

## Completed-With-Warning Cases

- GitHub review is a supported completed-with-warning path when the worked repository `.env.local` is missing, malformed, missing `CODEINFO_PR_TOKEN`, or provides only a blank token value.
- The same completed-with-warning status is also the truthful outcome when Story 60 cannot determine a trustworthy base branch, when the current branch has no usable upstream, when the automatic upstream push fails, or when PR creation fails after the explicit push-and-create path.
- Those skip or failure reasons are written into the active plan immediately so the review-cycle result does not pretend a clean external review occurred.

## Proof Surfaces

- Flow schema and copied-flow validation: `server/src/test/unit/flows-schema.test.ts`
- GitHub transport and token-contract coverage: `server/src/test/unit/flows.github-adapter.test.ts`
- GitHub scratch safe-replacement and malformed-state coverage: `server/src/test/unit/flows.github-scratch.test.ts`
- Runtime and lifecycle-sensitive flow behavior: `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/integration/flows.run.command.test.ts`
- Disabled ingested-variant preservation at `/flows`: `server/src/test/integration/flows.list.test.ts` and `client/src/test/flowsPage.runGuard.test.tsx`
- Authored flow composition: `server/src/test/features/flows-execution-runs.feature`
- Browser-visible flow selection surface: `e2e/flows-execution-runs.spec.ts`

## Manual Proof Notes

- Final manual proof should use the checked-in main stack via `npm run compose:build`, then `npm run compose:up`, with health confirmed at `http://localhost:5010/health` and the normal client at `http://localhost:5001`.
- Use a dedicated sandbox worked repository on the Story 60 branch under the host ingest root configured by `CODEINFO_HOST_INGEST_DIR`, and place `CODEINFO_PR_TOKEN` only in that worked repository `.env.local`.
- The close-out manual bundle should cover at least one short-wait clean cycle, one findings-present cycle, and, when practical, one supported completed-with-warning skip cycle, with task-scoped artifacts stored under `codeInfoTmp/manual-testing/0000060/5/` before later curation into `codeInfoStatus/manual-proof/0000060/`.
