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

From the user's point of view, a flow such as `flows/implement_next_plan.json` should be able to perform one bounded external review cycle without a human manually stitching the steps together. The flow should be able to open a pull request for the current branch, wait for a configured period, fetch the latest open pull request's review comments from other people, decide which of those comments are actually valid for the story, and then either stop cleanly or route the findings back through the existing minor-fix and task-up patterns.

The repository also has an important operational constraint: some existing flow files are already in use and must not be edited in place for this story. When the new review-cycle behavior is wired into a real workflow, the implementation must create new flow-definition variants by copying and renaming the relevant in-use flow files, then editing those new variants. This story therefore adds new workflow capabilities and new flow variants, rather than mutating the currently in-use checked-in flows directly.

This story is intentionally flow-only. The new primitives are being added for flow definitions, not for agent command JSON in this story. That keeps the implementation focused on the workflow surface that actually needs the external-review loop, and avoids expanding the scope into a second schema and runtime contract before the flow-first version has proved its value.

This story therefore introduces a small set of workflow primitives that stay intentionally thin and composable instead of embedding lots of hidden policy into one giant GitHub step. The new primitives are:

- a first-class `if` step with an optional `else`;
- the ability for `break`, `continue`, and `if` conditions to be driven either by the existing AI yes/no path or by a direct Python script that prints the authoritative answer;
- a persisted timed wait step whose duration is expressed in seconds;
- thin GitHub pull-request steps that can open a PR for the current branch, fetch the latest open PR review comments for the current branch, and close the latest open PR for the current branch.

The first intended use case is an external-review loop for implementation flows. This is separate from the repository's existing internal review and external-review-ingest flows. It happens only after the normal internal review believes the work is complete enough for outside review. The purpose of this GitHub review pass is not to re-run the whole existing review pipeline against a second copy of the same evidence; it is to inspect outside review comments, reject any comments that would force behavior changes outside the story scope, classify the valid ones, and then feed those valid findings into the same follow-up repair patterns the repository already uses after review.

When the flow opens a PR, it should not rely on a human to type the reviewer summary. The PR creation behavior for this story should generate a reviewer-facing title and body from the current story and implementation context. That generated content should explain what the story is trying to achieve, why the implemented changes were chosen, the rule that behavior outside the story scope must not be changed, and any other brief context a reviewer needs in order to give useful feedback without pulling the flow outside its intended boundaries.

A typical cycle is:

- open a PR for the current branch;
- wait for a configured window such as 15 minutes;
- fetch the latest open PR review comments from other users on that branch;
- decide which of those comments are valid under the repository's current story-scope rules, especially the rule that behavior outside the story scope must not be changed just because an external reviewer asked for it;
- classify the valid comments into small fixes that can be handled now versus larger findings that should become new story tasks;
- if there are no comments, or every comment is judged invalid or already non-actionable, treat the review cycle as clean and keep the PR open for human inspection;
- if valid issues exist, fix the small ones immediately, encode larger ones as tasks in the story, close that PR, and loop back into implementation and proof before opening a fresh PR for the next review cycle.

The GitHub integration for this story intentionally uses the simplest operational model. The server image may include the `gh` CLI and use a shared server-side GitHub identity through `GH_TOKEN` or `GITHUB_TOKEN`, with restricted permissions. The PR steps do not act as the currently logged-in browser user, and that is acceptable for this first version. Likewise, the "latest open PR for the branch" lookup rule is intentionally simple for this story: use the latest still-open PR for the current branch by open date, and ignore closed PRs.

If the current branch has not yet been pushed, the PR flow should push it automatically to its existing upstream remote so the review loop can continue without human intervention. If that automatic push fails, the flow should not keep guessing about alternate remotes or block forever waiting for help. Instead, it should record in the story that the PR could not be created, stop the external-review path for that cycle, and complete without treating missing GitHub review comments as implementation feedback.

Fetched GitHub review comments should also be kept separate from the existing external-review ingest files. They should be stored in their own transient GitHub-review scratch file, plus only the minimum additional persisted state needed for wait/resume and later classification.

This story should remain focused on enabling that review-loop orchestration. It is not trying to build a full GitHub integration platform, a general per-user GitHub auth model, or a fully generic workflow-state store for every future step type.

### Acceptance Criteria

- Flow definitions support a dedicated `if` step with `then` behavior and an optional `else` path.
- The new conditional behavior is available in flows in this story.
- Agent command JSON does not gain matching `if`, timed wait, or GitHub PR step support in this story.
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
- The GitHub PR creation behavior generates reviewer-facing PR title and body content from the current story and implementation context rather than requiring every flow to hard-code that text.
- The generated PR content explains what work was required, why the implemented changes were chosen, the restriction against behavior changes outside the story scope, and any other brief reviewer-relevant context needed for this review loop.
- For this story, "review comments" means PR review feedback from other users, including inline review comments and review submissions with reviewer-authored bodies, rather than generic issue-thread discussion.
- The GitHub comment-fetch step is a retrieval primitive only and does not embed completion policy, implicit waiting, or hidden conditional behavior.
- The GitHub steps use a shared server-side GitHub identity through `gh` plus `GH_TOKEN` or `GITHUB_TOKEN`, or an equivalent thin wrapper around that same model.
- The story documents the minimum GitHub permissions needed for open-PR, read-review-comments, and close-PR behavior, and keeps them restricted to that scope.
- If the current branch is not yet pushed, the PR creation path pushes automatically to the branch's existing upstream remote.
- If that automatic push or PR creation fails, the flow records a note in the story explaining that the PR could not be created and that external GitHub review comments were therefore not part of the implementation cycle.
- If PR creation fails, the flow can complete without attempting the GitHub wait or comment-ingestion steps for that cycle.
- The first-version PR lookup rule is explicit: use the latest open PR for the current branch by open date and ignore closed PRs.
- The first-version implementation does not attempt per-user GitHub execution identity or browser-user impersonation.
- The story does not edit currently in-use flow files in place under `flows/` when wiring in the new review-cycle behavior.
- When an existing checked-in flow needs the new review-cycle behavior, the implementation creates a copied and renamed flow-definition variant first, then applies the new step composition to that new variant.
- The first practical review-cycle wiring for this story lands in newly created flow-definition variants rather than by mutating the current `flows/implement_next_plan.json`, `flows/review_plan.json`, or other already in-use flow files directly.
- A flow can compose the new primitives so that it opens a PR, waits, fetches review comments, decides which comments are valid under the story-scope rules, classifies the valid findings, and then either completes cleanly or routes valid issues into the same minor-fix and task-up behavior already used after review.
- If the fetched review set is empty, that review cycle is treated as clean.
- If fetched review comments exist but all are classified as invalid, stale, outside story scope, or otherwise non-actionable, that review cycle is also treated as clean.
- If valid review issues exist, the flow can close the current review-cycle PR only after classification has determined that there is more work to do.
- When valid review issues exist, the flow can distinguish small issues that should be fixed immediately from larger issues that should become new story tasks, using the same repository repair patterns that already follow review findings.
- The final clean PR is intentionally left open for human review rather than being automatically closed at the end of a clean cycle.
- The new primitives are structured so they can later be reused by `flows/implement_next_plan.json` and adjacent review or implementation flows without needing a second incompatible step family.
- When the timed wait window ends, the flow resumes automatically without requiring human intervention.
- Fetched GitHub review comments are written to a separate transient GitHub-review scratch file rather than to the existing external-review ingest files, and only the minimal extra persisted state needed for resume and classification is stored alongside that scratch path.
- Automated tests cover the new schema shapes, runtime behavior, persisted wait behavior, Python decision execution path, GitHub step wiring, and the review-loop composition points touched by this story.

### Out Of Scope

- Acting as the currently logged-in browser user for GitHub operations.
- Building a full GitHub App auth model or per-user OAuth flow in this story.
- Adding matching `if`, timed wait, or GitHub PR steps to agent command JSON in this story.
- Embedding hidden IF logic directly into the GitHub pull-request comment step.
- Automatically reopening previously closed PRs or reusing a closed PR for a later review cycle.
- Replacing the existing local or external review-disposition rules with a brand-new classification system.
- Reusing the existing external-review ingest storage path or ingest flow as the raw-input path for this GitHub review cycle.
- Editing currently in-use checked-in flow definitions in place under `flows/` as part of this story.
- Solving every possible stale-PR, duplicate-PR, or multi-actor branch edge case before there is evidence that the first-version branch lookup rule is insufficient.
- Guessing alternate remotes, forks, or first-time publication targets when automatic branch push fails.
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

None at this time.

## Decisions

1. Flow-only primitive scope
   - The question being addressed: Should these new steps work in agent commands too, or should this story add them only to flows first?
   - Why the question matters: This changes the size of the story because flow JSON and agent command JSON use different schemas and runtimes today.
   - What the answer is: This story is flows only. Agent command JSON does not gain matching support for these new steps here.
   - Where the answer came from: User direction, plus local repo precedent in `planning/0000027-flows-mode.md`, `planning/0000061-command-and-flow-user-input-wait-step.md`, and `server/src/agents/commandsSchema.ts`.
   - Why it is the best answer: The user outcome is extending implementation and review flows, and keeping the first version flow-only avoids doubling the surface area before the design has proved itself in the place it is actually needed.
2. GitHub review-comment handling path
   - The question being addressed: Should fetched GitHub review comments go into the existing external review input file, or into a new storage path?
   - Why the question matters: The answer decides whether GitHub review comments reuse the current external-review ingest contract or form a separate review stage after internal review completion.
   - What the answer is: Use a separate GitHub-review stage after the normal internal review believes the work is complete. Do not feed the fetched GitHub review comments into the existing external-review ingest path. Instead, inspect those comments, reject requests that would change behavior outside the story scope, classify the valid ones, then reuse the repository's normal minor-fix and task-up repair patterns afterward.
   - Where the answer came from: User direction, plus local repo evidence from `flows/implement_next_plan.json`, `flows/ingest_external_review_plan.json`, and the existing review-disposition markdown contracts that already separate evidence gathering from later fix and task-up behavior.
   - Why it is the best answer: It preserves the user's intended lifecycle: internal review first, GitHub review second, and only a lighter-weight validity and classification pass on the outside feedback rather than a full second ingestion of the same review pipeline.
3. Timed-wait resume behavior
   - The question being addressed: When the wait time ends, should the flow resume by itself, or stay paused until someone resumes it?
   - Why the question matters: The intended PR-review loop is supposed to run without human babysitting.
   - What the answer is: Resume automatically when the timer expires.
   - Where the answer came from: User direction, plus local waiting-state precedent in `planning/0000061-command-and-flow-user-input-wait-step.md`, `planning/0000027-flows-mode.md`, `server/src/routes/flowsRun.ts`, and `server/src/flows/service.ts`, and the supporting Node.js timer docs that show plain timers are only in-process callbacks.
   - Why it is the best answer: Manual resume would break the autonomous review-loop goal, so the story needs persisted wait state plus automatic continuation when the review window ends.
4. PR content generation
   - The question being addressed: Should the PR step build the title and body from the current story, or should every flow write them out explicitly?
   - Why the question matters: `gh pr create` needs non-interactive title and body input, and this decision controls whether the review loop produces useful reviewer context without making every flow duplicate large summary text.
   - What the answer is: The PR step should generate reviewer-facing title and body content from the current story and implementation context. That content should explain what is required, why the implemented changes were chosen, the restriction against making behavior changes outside the story scope, and any other brief reviewer-relevant context.
   - Where the answer came from: User direction, plus local repo precedent in `codeinfo_markdown/create_pr_summary.md`, `codeinfo_markdown/task_up/01-shared-contract.md`, and `planning/0000055-pr-summary.md`, with supporting `gh pr create` documentation showing that non-interactive PR creation must supply title and body content explicitly.
   - Why it is the best answer: It keeps the flow authoring surface smaller while still producing a reviewable PR description that reinforces the story boundaries external reviewers should respect.
5. Auto-push and PR failure handling
   - The question being addressed: If the branch is not pushed yet, should the PR step push it automatically or fail?
   - Why the question matters: The review loop is supposed to run unattended, but pushing to the wrong remote or waiting forever for input would make the automation unsafe or brittle.
   - What the answer is: Push automatically to the existing upstream remote. If that push or the later PR creation fails, record a note in the story that the PR could not be created and that external comments were not taken into account for that cycle, then complete without continuing through the GitHub review path.
   - Where the answer came from: User direction, plus local repo precedent in `AGENTS.md` around branch workflow and non-interactive git usage, with supporting GitHub CLI documentation and DeepWiki notes showing that `gh pr create` otherwise falls back to interactive push or fork prompts.
   - Why it is the best answer: It preserves unattended execution in the normal case while failing safely and visibly instead of guessing at alternate remotes or leaving the story in an ambiguous half-reviewed state.
6. GitHub review scratch storage
   - The question being addressed: Should fetched GitHub review comments be saved in a separate scratch file, or only kept in flow memory?
   - Why the question matters: Later classification steps need restart-safe input, but this GitHub review stage must stay distinct from the repository's existing external-review ingest files.
   - What the answer is: Save fetched GitHub review comments in a separate transient GitHub-review scratch file, plus only the minimal persisted state needed for resume and later classification.
   - Where the answer came from: User direction, plus local repo precedent in `codeinfo_markdown/review_disposition.md`, `codeinfo_markdown/review_evidence_gate/01-core.md`, `scripts/story_workflow_status.py`, and `scripts/find_minor_fix_revalidation_task.py`, with supporting Node.js timer documentation showing why in-memory-only state is not durable enough across restarts.
   - Why it is the best answer: It keeps the GitHub review stage inspectable and restart-safe without polluting the separate external-review ingest path that this story intentionally leaves alone.

## Implementation Ideas

- Extend the flow schema and runtime dispatcher to introduce an `if` step that owns a condition source plus `thenSteps` and optional `elseSteps`.
- Keep the first implementation flow-only and document agent-command support as a later extension seam rather than part of this story.
- Refactor the current `break` and `continue` execution path so both the AI decision mode and the direct-script decision mode use one shared yes or no parsing and validation contract.
- Reuse the newer wrapper-script direction already planned for flow control under `scripts/flow_control/` so direct Python decisions stay deterministic and composable.
- Represent the timed wait step as persisted paused workflow state with a resume timestamp plus automatic continuation when the timer expires, rather than a plain in-memory sleep.
- Reuse the repository's existing waiting and resume concepts where they already exist or are planned, but adapt them for autonomous timer expiry rather than human-submitted resume input.
- Keep the GitHub PR steps intentionally narrow:
  - open PR for current branch;
  - fetch latest open PR review comments for current branch;
  - close latest open PR for current branch.
- Generate the PR title and body from current story context and implementation state, following the repository's existing reviewer-summary conventions so the PR explains the intended work, implementation rationale, and the no-out-of-scope-behavior-change rule.
- Resolve GitHub operations through `gh` inside the server runtime with one shared configured identity from `GH_TOKEN` or `GITHUB_TOKEN`.
- Before PR creation, push the branch to its configured upstream remote when needed; if that push or PR creation fails, record a story note and route the flow to a clean completion path that skips external-review ingestion for that cycle.
- Detect repository owner, name, current branch, and current head commit from the selected working repository rather than asking the user to duplicate that information in every workflow step.
- Treat fetched GitHub review comments as a separate post-internal-review input, not as the raw input for `flows/ingest_external_review_plan.json`.
- Persist fetched GitHub review comments in a dedicated transient GitHub-review scratch file plus the minimum extra resume metadata, rather than only in memory and rather than in the existing external-review ingest files.
- Add a lighter-weight GitHub-review validity and classification seam that rejects requests outside story scope, then hands valid findings into the same minor-fix and task-up repair patterns already used after review.
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
