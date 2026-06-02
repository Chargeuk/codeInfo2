# Story 0000060 - Users can automate GitHub PR review cycles with conditional, script, and wait steps

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevant information should be added to the other sections. The Questions section must be empty before creating tasks.

When tasks are later added to this story, use this section contract:

- `Subtasks` are for implementation and proof-authoring work that can be completed before formal proof runs.
- `Testing` is for automated proof execution only.
- `Manual Testing Guidance` is optional, non-blocking guidance for the manual testing agent and must not contain checkboxes.
- Outside `Additional Repositories`, use repository-relative paths, repository aliases, commands, environment-variable names, or other portable lookup directions instead of absolute filesystem paths.
- End each task's `Subtasks` section with separate lint and prettier or format-check subtasks in that order, and end each `Testing` section with separate lint and prettier or format-check steps in that order.
- Keep test-enablement seams such as auth bypasses, seeded identities, mocked providers, or alternate login helpers in test-only harnesses, fixtures, or test configuration rather than in shipped production behavior.
- Prefer the unmodified human Docker stack for manual testing whenever repository evidence shows it is runnable, and only fall back to minimal test-only enablement when the normal stack is not enough.
- Keep automated screenshots and similar generated proof artifacts in ignored artifact locations rather than tracked repository files.
- For any task, put manual-testing screenshots, logs, and similar proof artifacts in `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and do not commit them.
- If manual testing for the story will write task-level proof artifacts into `codeInfoTmp/` and `.gitignore` does not already ignore that scratch path, add or update that ignore rule before later proof depends on it.
- For story closeout, state that a later promotion step curates durable final proof into `codeInfoStatus/manual-proof/<story-number>/`.
- When Manual Testing Guidance mentions Playwright MCP screenshots, state that screenshots are captured in the Playwright output directory first and then transferred into the target repository task-scoped scratch destination. `CODEINFO_ROOT` is the harness root and may expose staging paths such as `$CODEINFO_ROOT/playwright-output-local`, but it is not the target artifact root unless the active plan is in the harness repository.
- When useful, recommend deterministic manual-proof basenames such as `proof-01-<slug>.png`, `support-console.txt`, `support-network.json`, and `support-<slug>.log` so later closeout can promote artifacts without guesswork.

### Description

CodeInfo2 already supports long-running implementation and review flows, but the current workflow primitives are too limited for an automated external-review cycle that opens a GitHub pull request, waits for outside feedback, classifies that feedback, and then either finishes cleanly or loops back into more implementation work. Today flows only have `llm`, `break`, `continue`, `command`, `reingest`, and `startLoop` style orchestration, and the review flows depend on local review artifacts rather than directly reading GitHub PR review comments.

From the user's point of view, a flow such as `flows/implement_next_plan.json` should be able to perform one bounded review cycle without a human manually stitching the steps together. The flow should be able to open a pull request for the current branch, wait for a configured period, fetch the latest open pull request's review comments from other people, classify those comments using the same validity and disposition rules already used by the repository's local and external review flows, and then either stop cleanly or route the findings back through the existing minor-fix and task-up patterns.

This story therefore introduces a small set of workflow primitives that stay intentionally thin and composable instead of embedding lots of hidden policy into one giant GitHub step. The new primitives are:

- a first-class `if` step with an optional `else`;
- the ability for `break`, `continue`, and `if` conditions to be driven either by the existing AI yes/no path or by a direct Python script that prints the authoritative answer;
- a persisted timed wait step whose duration is expressed in seconds;
- thin GitHub pull-request steps that can open a PR for the current branch, fetch the latest open PR review comments for the current branch, and close the latest open PR for the current branch.

The first intended use case is an external-review loop for implementation flows. A typical cycle is:

- open a PR for the current branch;
- wait for a configured window such as 15 minutes;
- fetch the latest open PR review comments from other users on that branch;
- classify the comments with the existing review-disposition contract used by `flows/review_plan.json` and `flows/ingest_external_review_plan.json`;
- if there are no comments, or every comment is judged invalid or already non-actionable, treat the review cycle as clean and keep the PR open for human inspection;
- if valid issues exist, fix the small ones immediately, encode larger ones as tasks in the story, close that PR, and loop back into implementation and proof before opening a fresh PR for the next review cycle.

The GitHub integration for this story intentionally uses the simplest operational model. The server image may include the `gh` CLI and use a shared server-side GitHub identity through `GH_TOKEN` or `GITHUB_TOKEN`, with restricted permissions. The PR steps do not act as the currently logged-in browser user, and that is acceptable for this first version. Likewise, the "latest open PR for the branch" lookup rule is intentionally simple for this story: use the latest still-open PR for the current branch by open date, and ignore closed PRs.

This story should remain focused on enabling that review-loop orchestration. It is not trying to build a full GitHub integration platform, a general per-user GitHub auth model, or a fully generic workflow-state store for every future step type.

### Acceptance Criteria

- Flow definitions support a dedicated `if` step with `then` behavior and an optional `else` path.
- The new conditional behavior is available in the workflow surface intended by the story, and the contract is explicit enough that later work can extend it consistently across flows and agent commands where appropriate.
- `break`, `continue`, and `if` conditions can continue using the existing AI yes or no decision path.
- `break`, `continue`, and `if` conditions can also be driven by a direct Python script execution path.
- The direct Python decision path has a strict contract for path resolution, working-directory rules, timeout behavior, exit-code handling, and stdout parsing.
- The direct Python decision path accepts only authoritative yes or no style output and does not silently reinterpret ambiguous results.
- Workflow definitions support a persisted timed wait step whose delay is configured in seconds.
- The timed wait step survives page refresh and server restart in the same spirit as other persisted workflow state, rather than existing only as in-memory sleep state.
- The wait duration is workflow-authored data, so a flow can set a review window such as 900 seconds without hard-coding that number into the runtime.
- Workflow definitions support a thin GitHub step that opens a pull request for the current branch.
- Workflow definitions support a thin GitHub step that fetches the latest open pull request's review comments for the current branch.
- Workflow definitions support a thin GitHub step that closes the latest open pull request for the current branch.
- For this story, "review comments" means PR review feedback from other users, including inline review comments and review submissions with reviewer-authored bodies, rather than generic issue-thread discussion.
- The GitHub comment-fetch step is a retrieval primitive only and does not embed completion policy, implicit waiting, or hidden conditional behavior.
- The GitHub steps use a shared server-side GitHub identity through `gh` plus `GH_TOKEN` or `GITHUB_TOKEN`, or an equivalent thin wrapper around that same model.
- The story documents the minimum GitHub permissions needed for open-PR, read-review-comments, and close-PR behavior, and keeps them restricted to that scope.
- The first-version PR lookup rule is explicit: use the latest open PR for the current branch by open date and ignore closed PRs.
- The first-version implementation does not attempt per-user GitHub execution identity or browser-user impersonation.
- A flow can compose the new primitives so that it opens a PR, waits, fetches review comments, classifies them using the existing review-disposition rules, and then either completes cleanly or routes valid issues into the same minor-fix and task-up behavior already used for local or external review findings.
- If the fetched review set is empty, that review cycle is treated as clean.
- If fetched review comments exist but all are classified as invalid, stale, or otherwise non-actionable under the existing review-disposition rules, that review cycle is also treated as clean.
- If valid review issues exist, the flow can close the current review-cycle PR only after classification has determined that there is more work to do.
- When valid review issues exist, the flow can distinguish small issues that should be fixed immediately from larger issues that should become new story tasks, using the same repository review rules rather than inventing a second classification system.
- The final clean PR is intentionally left open for human review rather than being automatically closed at the end of a clean cycle.
- The new primitives are structured so they can later be reused by `flows/implement_next_plan.json` and adjacent review or implementation flows without needing a second incompatible step family.
- Automated tests cover the new schema shapes, runtime behavior, persisted wait behavior, Python decision execution path, GitHub step wiring, and the review-loop composition points touched by this story.

### Out Of Scope

- Acting as the currently logged-in browser user for GitHub operations.
- Building a full GitHub App auth model or per-user OAuth flow in this story.
- Embedding hidden IF logic directly into the GitHub pull-request comment step.
- Automatically reopening previously closed PRs or reusing a closed PR for a later review cycle.
- Replacing the existing local or external review-disposition rules with a brand-new classification system.
- Solving every possible stale-PR, duplicate-PR, or multi-actor branch edge case before there is evidence that the first-version branch lookup rule is insufficient.
- Building a general arbitrary workflow variable system in this story.
- Removing the existing AI-based yes or no control path for `break` and `continue`.
- Expanding the GitHub integration into issue management, labels, assignees, or merge automation unless directly required by the thin PR-review cycle described here.

### Additional Repositories

- No Additional Repositories

### Story Manual Testing Guidance

- Prefer a dedicated sandbox repository or other non-production repository for manual GitHub proof so PR open and close actions do not disturb normal team work.
- Keep the first manual proof focused on one happy-path review cycle and one cycle that finds valid issues, rather than trying to exhaust every GitHub edge case in a single pass.
- When proving the wait step manually, use a short temporary delay in the authored flow for proof speed even though the real target flow may later use 900 seconds.
- When proving external review ingestion, ensure the retained evidence clearly shows that the comments came from other reviewers rather than from the PR author.
- Where possible, rely on mocked or fixture-backed automated proof for the GitHub API or CLI seams and reserve live GitHub manual proof for a small number of confidence checks.

### Questions

None. The first-version direction is now fixed: thin workflow primitives, persisted timed wait, shared server-side `gh` identity, latest open PR for the branch by open date, and review classification through the existing local or external review-disposition contract.

## Implementation Ideas

- Extend the flow schema and runtime dispatcher to introduce an `if` step that owns a condition source plus `thenSteps` and optional `elseSteps`.
- Decide whether agent command JSON should gain matching primitives now or whether the first implementation should land in flows first with a clearly documented extension seam for commands.
- Refactor the current `break` and `continue` execution path so both the AI decision mode and the direct-script decision mode use one shared yes or no parsing and validation contract.
- Reuse the newer wrapper-script direction already planned for flow control under `scripts/flow_control/` so direct Python decisions stay deterministic and composable.
- Represent the timed wait step as persisted paused workflow state with a resume timestamp, rather than a plain in-memory sleep.
- Reuse the repository's existing waiting and resume concepts where they already exist or are planned, instead of inventing a second pause lifecycle just for timed waits.
- Keep the GitHub PR steps intentionally narrow:
  - open PR for current branch;
  - fetch latest open PR review comments for current branch;
  - close latest open PR for current branch.
- Resolve GitHub operations through `gh` inside the server runtime with one shared configured identity from `GH_TOKEN` or `GITHUB_TOKEN`.
- Detect repository owner, name, current branch, and current head commit from the selected working repository rather than asking the user to duplicate that information in every workflow step.
- Feed the fetched PR review comments into the same review evidence, findings, saturation, blind-spot, and classification pattern already used by `flows/review_plan.json` and `flows/ingest_external_review_plan.json` rather than inventing a separate "GitHub review validity" model.
- Use the new `if` step to express the clean-review versus more-work-needed branch explicitly instead of hiding that rule inside one GitHub step.
- If classification finds valid issues, reuse the existing minor-fix and task-up flow ideas so the external-review cycle behaves like the repository's current review discipline rather than a parallel process.
- Add focused proof for:
  - schema parsing of the new step types;
  - persisted wait/resume behavior;
  - direct Python decision success and failure cases;
  - GitHub PR open, fetch, and close wiring under mocked credentials;
  - latest-open-PR-by-branch lookup;
  - comment filtering so only review feedback from other users is treated as input;
  - composition of a flow that cleanly exits when no actionable review comments exist;
  - composition of a flow that closes the PR and loops when valid review work remains.
