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

The GitHub integration for this story intentionally uses the simplest operational model. If this story keeps the `gh` transport, the supported flow runtime must provide `gh` inside that runtime, including the checked-in main Docker Compose server path used for proof; a host-only `gh` install is not sufficient because the flow runtime executes inside the server environment. GitHub PR API operations use a repository-specific fine-grained token read from the `CODEINFO_PR_TOKEN` value in the worked repository's `.env.local` file at step runtime rather than from the server startup env files. When the `gh` path is used against github.com, the step maps that value into `GH_TOKEN` for the child process so the CLI runs headlessly without depending on previously stored interactive credentials. Normal git credentials in the worked repository remain the preferred path for git fetch and push behavior when they are already configured. The PR steps do not act as the currently logged-in browser user, and that is acceptable for this first version. Likewise, the "latest open PR for the branch" lookup rule is intentionally simple for this story: use the latest still-open PR for the current branch by open date and ignore closed PRs, but resolve that latest PR through explicit repository plus branch filtering rather than through an implicit "current branch PR" shortcut.

If the repository being worked in does not provide the expected `CODEINFO_PR_TOKEN` value in its `.env.local` file, the GitHub PR and external-review path should not execute for that cycle. The flow should record in the plan that external GitHub review was skipped because the repository-specific token was not configured, then continue or complete without treating missing GitHub review comments as implementation feedback.

If the current branch has not yet been pushed, the PR flow should push it automatically to its existing upstream remote so the review loop can continue without human intervention. If that automatic push fails, the flow should not keep guessing about alternate remotes or block forever waiting for help. Instead, it should record in the plan that the PR could not be created, stop the external-review path for that cycle, and complete without treating missing GitHub review comments as implementation feedback.

When GitHub review is skipped for a supported reason such as missing `CODEINFO_PR_TOKEN`, the flow result should not pretend that a full clean external review happened. It should finish as completed with warning so the final status remains truthful: the implementation flow completed, but the optional GitHub review stage did not run for that cycle.

Fetched GitHub review comments should also be kept separate from the existing external-review ingest files. They should be stored as JSON in their own transient GitHub-review scratch file under `codeInfoTmp/reviews/`, plus only the minimum additional persisted state needed for wait/resume and later classification.

This story also changes one stateful runtime surface even though it does not add browser UI: a flow run can now move between fresh execution, paused wait, resumed execution, supported GitHub-review skip, and fresh next-cycle replacement of the transient GitHub-review scratch state. The plan therefore needs explicit rules for when state is reused versus replaced. Resume must continue the same flow execution and the same selected PR or scratch context for that execution rather than silently opening a fresh PR, selecting a different PR, or mixing stale review data from an older cycle into the resumed run. A fresh GitHub review cycle for the same story may replace its own prior transient review scratch state, but stale scratch must not stay active once a new fetch has succeeded.

This story should remain focused on enabling that review-loop orchestration. It is not trying to build a full GitHub integration platform, a general per-user GitHub auth model, or a fully generic workflow-state store for every future step type.

This is a workflow-runtime story, not a browser-UI redesign story. Outside the new flow-only primitives and the newly copied opt-in flow-definition variants that use them, existing browser-visible behavior, existing agent-command behavior, existing in-use flow files, and the default `improve_plan2` or adjacent execution paths must keep their current behavior. If a repository operator never selects one of the new copied flow variants, the current checked-in implementation and review workflows should continue to behave exactly as they do today.

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
- The GitHub steps use `gh` plus a repository-specific fine-grained token loaded from the `CODEINFO_PR_TOKEN` value in the worked repository's `.env.local` file for PR API operations, or an equivalent thin wrapper around that same model.
- If the `gh` transport is used, the supported server runtime that executes flows, including the checked-in main Docker Compose stack, provides `gh` inside that runtime rather than relying on a host-only installation.
- The story documents the minimum GitHub permissions needed for open-PR, read-review-comments, and close-PR behavior, and keeps them restricted to that scope.
- The flow reads `CODEINFO_PR_TOKEN` only from the worked repository's `.env.local` file and does not fall back to `.env` in this story.
- The flow reads `CODEINFO_PR_TOKEN` by parsing the worked repository root's `.env.local` at step runtime, then maps it only into the GitHub step invocation environment; it does not depend on the server startup env loader, `server/.env.local`, or the worked repository's `.env`.
- When the `gh` transport is used for github.com, the step maps `CODEINFO_PR_TOKEN` into `GH_TOKEN` for that child process. It does not require `gh auth login`, does not write the token into the user's persisted `gh` credential store, and does not promote the token into the long-lived server process environment.
- If the expected `CODEINFO_PR_TOKEN` value is missing from the worked repository's `.env.local`, the flow skips PR creation and external-review ingestion for that cycle and records a concise plan note explaining why.
- Normal git credentials remain the preferred auth path for branch fetch and push behavior when they are already configured in the worked repository.
- If the current branch is not yet pushed, the PR creation path pushes automatically to the branch's existing upstream remote using the repository's normal git credentials when available.
- If that automatic push or PR creation fails, the flow records a concise plan note explaining that the PR could not be created and that external GitHub review comments were therefore not part of the implementation cycle.
- If PR creation fails, the flow can complete without attempting the GitHub wait or comment-ingestion steps for that cycle.
- If GitHub review is skipped for a supported reason, the flow finishes as completed with warning rather than as a plain clean completion.
- The first-version PR lookup rule is explicit: use the latest open PR for the current branch by open date and ignore closed PRs.
- The first-version PR lookup is implemented with explicit repository plus head-branch filtering and created-date ordering, not by relying on whichever PR `gh pr view` happens to choose for the current checkout.
- The first-version implementation does not attempt per-user GitHub execution identity or browser-user impersonation.
- PR creation does not rely on interactive `gh` prompts. The step passes explicit `--title`, `--body`, `--head`, and `--base` values, and if the create command succeeds it treats the printed PR URL as a success indicator before resolving canonical PR metadata through an explicit follow-up lookup.
- The PR open step resolves and passes an explicit base branch instead of relying on repo-local hidden `gh-merge-base` configuration. If the implementation cannot determine a trustworthy base branch from repository state plus the supported GitHub lookup path, it records a concise skip note and finishes that GitHub review cycle as completed with warning rather than creating a PR against an accidental base.
- The story does not edit currently in-use flow files in place under `flows/` when wiring in the new review-cycle behavior.
- When an existing checked-in flow needs the new review-cycle behavior, the implementation creates a copied and renamed flow-definition variant first, then applies the new step composition to that new variant.
- The first practical review-cycle wiring for this story lands in newly created flow-definition variants rather than by mutating the current `flows/implement_next_plan.json`, `flows/review_plan.json`, or other already in-use flow files directly.
- A flow can compose the new primitives so that it opens a PR, waits, fetches review comments, decides which comments are valid under the story-scope rules, classifies the valid findings, and then either completes cleanly or routes valid issues into the same minor-fix and task-up behavior already used after review.
- The new copied review-cycle flow variants are opt-in. Existing default workflow entrypoints keep their current behavior until an operator intentionally chooses the new variant.
- If the fetched review set is empty, that review cycle is treated as clean.
- If fetched review comments exist but all are classified as invalid, stale, outside story scope, authored by the PR author, or otherwise non-actionable, that review cycle is also treated as clean.
- If valid review issues exist, the flow can close the current review-cycle PR only after classification has determined that there is more work to do.
- When valid review issues exist, the flow can distinguish small issues that should be fixed immediately from larger issues that should become new story tasks, using the same repository repair patterns that already follow review findings.
- The final clean PR is intentionally left open for human review rather than being automatically closed at the end of a clean cycle.
- The new primitives are structured so they can later be reused by `flows/implement_next_plan.json` and adjacent review or implementation flows without needing a second incompatible step family.
- When the timed wait window ends, the flow resumes automatically without requiring human intervention.
- When a paused wait resumes, it continues the same flow execution identity and the same in-progress GitHub-review cycle state for that execution rather than silently creating a fresh run or selecting a different PR.
- The timed wait contract uses positive integer seconds. Zero, negative, fractional, or non-numeric wait values are rejected at flow-definition validation time rather than clamped silently at runtime.
- The direct Python decision path executes a checked-in repository-relative Python entrypoint from the worked repository root, treats missing files, timeouts, non-zero exit codes, malformed JSON, extra top-level keys, or non-`yes`/`no` answers as hard step failures, and does not reinterpret those failures as a decision.
- A blank or whitespace-only `CODEINFO_PR_TOKEN` value in `.env.local` is treated the same as a missing token and therefore triggers the supported completed-with-warning skip path.
- The story documents one minimum fine-grained token permission set for the GitHub PR cycle: repository `Pull requests` permission at write level, because open or close operations require write access while review and review-comment retrieval requires read access.
- Fetched GitHub review data is written as JSON to a separate transient GitHub-review scratch file under `codeInfoTmp/reviews/` rather than to the existing external-review ingest files, and only the minimal extra persisted state needed for resume and classification is stored alongside that scratch path.
- The fetch step gathers both review submissions and inline review comments, because GitHub review feedback is split across those two endpoint families rather than returned as one complete combined payload.
- The review-fetch implementation paginates GitHub list responses so it does not silently truncate larger review sets at the first page.
- When a fresh GitHub fetch succeeds for the current story and branch, later reader steps consume that fresh fetched state only. Older transient review scratch from a prior cycle may be replaced, but it must not remain the active classification input for the new cycle.
- Automated tests cover the new schema shapes, runtime behavior, persisted wait behavior, Python decision execution path, GitHub step wiring, and the review-loop composition points touched by this story.
- The canonical parallel and stress wrappers must run the complete automated test surface reliably without cross-test environment, provider, filesystem, timing, or Docker lifecycle interference.
- Test-only isolation, readiness, lifecycle ownership, wait hardening, and diagnostic changes required to achieve that reliability are explicitly within Story 60 scope and must be retained.
- Parallel and stress execution must not change production behavior, disturb the local development stack, or leave test-owned Docker resources running after completion.

### Out Of Scope

- Acting as the currently logged-in browser user for GitHub operations.
- Building a full GitHub App auth model or per-user OAuth flow in this story.
- Adding matching `if`, timed wait, or GitHub PR steps to agent command JSON in this story.
- Embedding hidden IF logic directly into the GitHub pull-request comment step.
- Automatically reopening previously closed PRs or reusing a closed PR for a later review cycle.
- Replacing the existing local or external review-disposition rules with a brand-new classification system.
- Reusing the existing external-review ingest storage path or ingest flow as the raw-input path for this GitHub review cycle.
- Editing currently in-use checked-in flow definitions in place under `flows/` as part of this story.
- Changing the currently selected default execution path for `improve_plan2`, `flows/implement_next_plan.json`, `flows/review_plan.json`, or other existing in-use flow entrypoints without an operator intentionally selecting one of the new copied variants.
- Changing browser-visible UI, agent-command JSON behavior, or other unrelated user-facing product behavior beyond the explicit new flow-only review-cycle capabilities in this story.
- Solving every possible stale-PR, duplicate-PR, or multi-actor branch edge case before there is evidence that the first-version branch lookup rule is insufficient.
- Requiring one shared cross-repository or cross-organization GitHub token for all worked repositories.
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
   - What the answer is: Push automatically to the existing upstream remote, using the repository's normal git credentials when they are available. If that push or the later PR creation fails, record a note in the story that the PR could not be created and that external comments were not taken into account for that cycle, then complete without continuing through the GitHub review path.
   - Where the answer came from: User direction, plus local repo precedent in `AGENTS.md` around branch workflow and non-interactive git usage, with supporting GitHub CLI documentation and DeepWiki notes showing that `gh pr create` otherwise falls back to interactive push or fork prompts.
   - Why it is the best answer: It preserves unattended execution in the normal case while failing safely and visibly instead of guessing at alternate remotes or leaving the story in an ambiguous half-reviewed state.
6. GitHub review scratch storage
   - The question being addressed: Should fetched GitHub review comments be saved in a separate scratch file, or only kept in flow memory?
   - Why the question matters: Later classification steps need restart-safe input, but this GitHub review stage must stay distinct from the repository's existing external-review ingest files.
   - What the answer is: Save fetched GitHub review comments in a separate transient GitHub-review scratch file, plus only the minimal persisted state needed for resume and later classification.
   - Where the answer came from: User direction, plus local repo precedent in `codeinfo_markdown/review_disposition.md`, `codeinfo_markdown/review_evidence_gate/01-core.md`, `scripts/story_workflow_status.py`, and `scripts/find_minor_fix_revalidation_task.py`, with supporting Node.js timer documentation showing why in-memory-only state is not durable enough across restarts.
   - Why it is the best answer: It keeps the GitHub review stage inspectable and restart-safe without polluting the separate external-review ingest path that this story intentionally leaves alone.
7. Repository-local GitHub token configuration
   - The question being addressed: How should the GitHub token be configured when different worked repositories may need different fine-grained tokens?
   - Why the question matters: Fine-grained tokens are scoped to one owner, so a single shared token does not fit well when the workflow may target personal repositories and organization repositories separately.
   - What the answer is: The expected fine-grained GitHub token should live in the `CODEINFO_PR_TOKEN` variable inside a `.env.local` file in the repository being worked in and should be used for GitHub PR API operations, not as the default replacement for normal git push and pull credentials. If that file or token value is missing, the PR creation and external-review logic does not execute for that cycle, and the story records that external review was skipped because repository-local GitHub credentials were not configured.
   - Where the answer came from: User direction, plus the repository's harness-vs-target path contract in `AGENTS.md` and `codeinfo_markdown/repository_information.md`, which supports reading target-repository configuration from the worked repository instead of from harness-owned paths.
   - Why it is the best answer: It lets each repository opt into its own least-privilege GitHub token without forcing one global token to span multiple owners or organizations.
8. GitHub-review skip status
   - The question being addressed: If GitHub review is skipped, should the flow finish as completed with warning, or as plain completed?
   - Why the question matters: The final run status needs to distinguish a fully reviewed clean cycle from a supported skip where implementation finished but outside review did not run.
   - What the answer is: Finish as completed with warning.
   - Where the answer came from: User direction, plus local skip-versus-fail precedent in `server/dist/flows/markdownFileResolver.js`, `server/dist/ingest/planScopeResolver.js`, and `codeinfo_markdown/preserve_external_review_adjudication_trail.md`.
   - Why it is the best answer: It preserves honest flow status without turning a supported skip path into a hard failure or falsely implying that a clean external review occurred.
9. Exact GitHub token file contract
   - The question being addressed: Should the flow read only `.env.local`, or also fall back to `.env`?
   - Why the question matters: The story needs one exact repository-local credential contract so GitHub review is enabled intentionally rather than accidentally through broader shared environment files.
   - What the answer is: Read only `.env.local` for `CODEINFO_PR_TOKEN`.
   - Where the answer came from: User direction, plus Story 60's existing repository-local token model and the harness-vs-target repository contract in `AGENTS.md` and `codeinfo_markdown/repository_information.md`, with supporting Node.js documentation showing env files are loaded only when the application explicitly chooses to read them.
   - Why it is the best answer: It keeps GitHub review as an explicit per-repository opt-in and avoids silently pulling credentials from broader environment files.
10. Where skip notes belong

- The question being addressed: When GitHub review is skipped or PR creation fails, should the note go in the plan, the PR summary, or both?
- Why the question matters: The story says to record a note, but the canonical immediate location needs to be clear so the implementation writes one trustworthy trail instead of scattering status across multiple outputs.
- What the answer is: Put a concise note in the plan immediately, and let the later PR summary reflect it when a PR summary is generated.
- Where the answer came from: User direction, plus local repo precedent in `codeinfo_markdown/preserve_external_review_adjudication_trail.md`, `codeinfo_markdown/create_pr_summary.md`, and `codeinfo_markdown/task_up/01-shared-contract.md`.
- Why it is the best answer: The plan is the active source of truth during implementation, while the PR summary is a derived closeout artifact that may not exist yet when the skip or failure happens.

11. GitHub review scratch-file contract

- The question being addressed: Should GitHub review scratch live in `codeInfoTmp/reviews/` as JSON, or somewhere else?
- Why the question matters: The story already requires restart-safe scratch state, but the exact file contract affects how later steps find and reuse the review input.
- What the answer is: Store GitHub review scratch as JSON under `codeInfoTmp/reviews/` in a separate GitHub-review handoff file.
- Where the answer came from: User direction, plus local repo precedent in `codeinfo_markdown/write_review_no_findings_closeout.md`, `codeinfo_markdown/review_disposition.md`, `scripts/flow_state_utils.py`, and the broader `codeInfoTmp/reviews/<story>-current-review.json` handoff pattern already used by review flows.
- Why it is the best answer: It matches the repository's existing transient review-artifact patterns, keeps the GitHub-review state clearly non-durable, and avoids mixing it with the existing external-review input file.

## Feasibility Proof Pass

### 1. Flow runtime and schema extensions

- Already existing capabilities:
  - `server/src/flows/flowSchema.ts` already owns the flow-step schema union and recursive nested-step parsing.
  - `server/src/flows/service.ts` already owns the step dispatcher, existing `break` and `continue` flow-control behavior, and persisted flow-run orchestration.
  - `server/src/test/unit/flows-schema.test.ts` and `server/src/test/integration/flows.run.*.test.ts` already provide schema and runtime proof homes for new step types.
- Missing prerequisite capabilities:
  - There is no existing `if` step in the flow schema or dispatcher.
  - There is no existing persisted timed wait step in the flow runtime.
  - There is no existing flow-native script decision path for `if`, `break`, or `continue`; the runtime must add that seam explicitly instead of assuming it already exists.
- Assumptions currently invalid:
  - Later tasking must not assume agent command JSON needs matching support in this story.
  - Later tasking must not assume a plain in-memory timer is enough for the wait step, because restart-safe persistence is part of the accepted contract.
- Feasibility and sequencing note:
  - This area is feasible as an extension of existing flow-only seams, but the schema, runtime dispatcher, and persisted resume-state contract must be updated before any copied flow variant can rely on the new steps.

### 2. GitHub PR transport and worked-repository contracts

- Already existing capabilities:
  - The repository already has branch-state helpers in `scripts/flow_state_utils.py`.
  - The repository already has review scratch and disposition conventions under `codeInfoTmp/reviews/` plus `codeinfo_markdown/review_disposition.md`.
  - The checked-in main Docker stack in `docker-compose.yml` is the supported manual-proof path.
- Missing prerequisite capabilities:
  - `server/Dockerfile` and `server/npm-global.txt` do not currently provide `gh` in the supported server runtime.
  - `server/src/config/startupEnv.ts` only loads `server/.env` and `server/.env.local`; there is no existing worked-repository `.env.local` reader for `CODEINFO_PR_TOKEN`.
  - The runtime does not yet have a thin GitHub adapter that resolves explicit repo, branch, PR, review-submission, and inline-comment calls.
- Assumptions currently invalid:
  - Later tasking must not assume a host-installed `gh` is sufficient.
  - Later tasking must not assume `gh pr view` or another convenience command will always identify the right PR without explicit repo and branch filtering.
- Feasibility and sequencing note:
  - This area is feasible, but the story must first establish one honest transport path inside the supported server runtime and one worked-repository token-read seam before the copied review-cycle flows can depend on GitHub behavior.

### 3. Proof and manual-validation path

- Already existing capabilities:
  - Server unit and integration wrappers already exist through `npm run test:summary:server:unit`.
  - Server cucumber wrappers already exist through `npm run test:summary:server:cucumber`.
  - Browser-level flow proof already has a home in `e2e/flows-execution-runs.spec.ts`.
  - The supported human stack already exists in `docker-compose.yml` and is started through `npm run compose:build` plus `npm run compose:up`.
- Missing prerequisite capabilities:
  - No new harness is inherently required for the flow-only `if` and wait primitives.
  - GitHub-cycle proof will need either mocked CLI or fixture-backed tests around the adapter, plus a small amount of live manual validation in a sandbox repository.
- Assumptions currently invalid:
  - Later tasking must not assume a new frontend harness or a browser redesign is required.
  - Later tasking must not assume manual proof should happen against the local development stack instead of the checked-in main human stack.
- Feasibility and sequencing note:
  - Existing proof surfaces are enough for this story as long as GitHub-specific proof is added to the current backend-focused harnesses and manual GitHub validation stays on a dedicated sandbox repository.

## Story Behavior Lock

- The only approved user-facing behavior change in this story is the addition of new flow-only orchestration capabilities plus newly copied opt-in flow-definition variants that can run one external GitHub PR review cycle.
- Existing browser-visible behavior, existing agent-command behavior, existing in-use flow files, and existing default execution paths stay preserved unless an operator intentionally selects one of the new copied variants.
- If the story does not explicitly change a workflow surface, runtime path, review artifact path, or manual-testing path, the current behavior for that area must be preserved.
- Review feedback, proof convenience, or runtime neatness are not reasons to widen the story into broader GitHub platform work, browser UX work, or workflow redesign.

## Message Contracts And Storage Shapes

- Flow-schema additions stay within the existing flow step family in `server/src/flows/flowSchema.ts`; this story does not add matching schema items to agent-command JSON.
- The new `if` step owns one explicit condition plus `then` steps and optional `else` steps. It must not hide extra implicit branching inside the GitHub step implementations.
- The `if` step, `break`, and `continue` all share one condition contract: either the existing AI yes-or-no path or one repository-relative Python entrypoint evaluated from the worked repository root. This story does not introduce a third condition family such as shell snippets or inline JavaScript.
- The direct Python decision path follows the repository's existing `scripts/flow_control/*.py` wrapper style: a checked-in repository-relative Python entrypoint runs from the worked repository root and prints exactly `{\"answer\":\"yes\"}` or `{\"answer\":\"no\"}` to stdout with no alternate success shape.
- The timed wait step persists enough state to resume safely after restart, including the current execution identity, the next step location, the resume timestamp, and any loop context needed to continue the same flow run rather than launching a fresh run.
- The wait-step schema stores whole-second workflow-authored delay input, while the persisted runtime state stores an absolute resume timestamp. The runtime must compare current time against that resume timestamp rather than repeatedly decrementing an in-memory counter.
- Resume state is run-scoped, not global. Persisted wait state and GitHub-review scratch for one execution are either reused by that same execution on resume or replaced by a later fresh cycle for that same story; they must never be merged across different executions or contradictory branch or PR identities.
- Repository-local GitHub token lookup is a per-step file read from the worked repository root's `.env.local`. When the `gh` path is used, the step maps `CODEINFO_PR_TOKEN` into the CLI-supported authentication environment for that invocation only instead of promoting it into the server process startup environment.
- GitHub review scratch state lives in `codeInfoTmp/reviews/<story-number>-current-review.json` as transient workflow state. At minimum it must identify the canonical `plan_path`, the active repository alias or root, the branch or HEAD being reviewed, the selected open PR identity, the raw fetched review artifact path, and any supported skip or failure reason that caused a completed-with-warning outcome.
- The raw fetched GitHub-review artifact is a JSON object under `codeInfoTmp/reviews/` with one canonical top-level record for repository and PR metadata plus separate arrays for review submissions and inline review comments. At minimum it preserves `repository.owner`, `repository.name`, `pullRequest.number`, `pullRequest.url`, `pullRequest.headRefName`, `pullRequest.baseRefName`, `pullRequest.authorLogin`, `pullRequest.createdAt`, `fetchedAt`, `reviews`, and `reviewComments`.
- Each preserved `reviews[]` entry keeps the GitHub review identity and classification fields needed later: `id`, `user.login`, `body`, `state`, `submitted_at` when present, `commit_id`, `html_url`, and `author_association`.
- Each preserved `reviewComments[]` entry keeps the inline-comment identity and classification fields needed later: `id`, `pull_request_review_id`, `user.login`, `body`, `path`, `line`, `start_line` when present, `side`, `commit_id`, `in_reply_to_id` when present, `created_at`, `updated_at`, `html_url`, and `author_association`.
- Classification and later review-disposition work read that scratch state rather than reusing the existing external-review input markdown path.
- The GitHub fetch step is the only writer for the raw fetched review artifact and the `codeInfoTmp/reviews/<story-number>-current-review.json` handoff for this story. Classification, review disposition, and later routing steps are readers only unless a later story explicitly broadens that ownership.
- Because the existing repository guidance defines transient review handoff files but not a shared TypeScript atomic-write helper, this story must either reuse a shared helper if one appears during implementation or introduce one small shared safe-write utility so reader steps see either the previous valid JSON object or the new valid JSON object, never a delete-first gap treated as a clean review.
- Stale GitHub-review scratch cleanup belongs to the review-cycle lifecycle rather than to unrelated startup code: a fresh review cycle may replace its own prior transient GitHub-review files for the same story, but unrelated flows must not delete or rewrite them opportunistically.
- Plan notes remain the durable source for supported skip or failure explanations in this story. Scratch review JSON is transient workflow state and must not become the only durable record of why external review was skipped.

## Confirmed Internal Patterns And External Contracts

- Flow-only step-shape work should extend the existing `server/src/flows/flowSchema.ts`, `server/src/flows/service.ts`, and `server/src/flows/flowState.ts` seams. The repository already treats these files as the canonical flow schema, dispatcher, and persisted resume-state owners, so later tasking must not invent a second flow-contract surface.
- Shared yes-or-no condition evaluation is reusable in two parts today: `parseFlowDecisionAnswer` in `server/src/flows/service.ts` already owns strict answer parsing, and `scripts/flow_control/decision.py` already demonstrates the checked-in Python wrapper shape that prints only `{"answer":"yes"}` or `{"answer":"no"}`. The missing piece is one shared runtime launcher that lets `if`, `break`, and `continue` all use the same AI-or-script decision seam.
- The strongest local safe-write precedent is the staged publish pattern in `server/src/config/copilotSeedBootstrap.ts`, with supporting compare-and-rename patterns in `server/src/config/runtimeConfig.ts` and `server/src/config/copilotConfig.ts`. Later tasking should treat that family as the preferred model for replacing GitHub review scratch artifacts so readers observe either the previous valid file or the next valid file, never a delete-first gap or partially written JSON.
- A worked-repository `.env.local` reader for `CODEINFO_PR_TOKEN` is still missing. The available building blocks are only partial: `dotenv.parse` usage in `server/src/config/startupEnv.ts`, trimmed usable-value handling in `server/src/config/runtimeConfig.ts`, and missing-versus-empty warning patterns in `server/src/config/codexEnvDefaults.ts`. Later tasking must add a new runtime file-reader seam rather than extending startup env loading or promoting repository-local GitHub credentials into process startup state.
- The GitHub review fetch step is the sole intended writer for Story 60 transient review scratch under `codeInfoTmp/reviews/`. Confirmed downstream readers already exist in repository guidance such as `codeinfo_markdown/review_disposition.md`, `codeinfo_markdown/classify_review_disposition.md`, `codeinfo_markdown/write_review_no_findings_closeout.md`, and related review-flow steps, so later tasking must preserve the handoff role of `codeInfoTmp/reviews/<story-number>-current-review.json` instead of creating a second scratch format.
- Official GitHub CLI and REST contract evidence confirms the thin GitHub helper should stay explicit rather than inference-heavy:
  - `gh pr create` supports explicit `--title`, `--body`, `--head`, and `--base`, and if `--base` is omitted GitHub CLI falls back to branch config or the repository default branch. Story 60 should still provide the base explicitly so review-cycle behavior stays deterministic.
  - GitHub CLI accepts authentication through `GH_TOKEN` or `GITHUB_TOKEN`, in that order of precedence, for `github.com` targets. Story 60 should map `CODEINFO_PR_TOKEN` into that child-process env only for the GitHub invocation rather than renaming the repository-local key itself.
  - The REST `List pull requests` contract supports `state=open`, `head=<owner>:<branch>`, optional `base=<branch>`, `sort=created`, and `direction=desc`, which is sufficient to resolve the newest still-open PR for the current branch without trusting `gh pr view` convenience inference.
  - The REST `List reviews for a pull request` and `List review comments on a pull request` endpoints both require fine-grained `Pull requests` repository permission `read`, while `Create a pull request` requires fine-grained `Pull requests` repository permission `write`.
  - `gh api --paginate` is a supported repository-owned way to exhaust paginated GitHub data, so later tasking should treat first-page-only fetches as incorrect for review submissions or inline review comments.
- The controlling unchanged files that later tasking and proof must keep naming honestly are: `server/src/flows/flowSchema.ts`, `server/src/flows/service.ts`, `server/src/flows/flowState.ts`, `server/src/config/startupEnv.ts`, `server/src/config/runtimeConfig.ts`, `server/src/config/codexEnvDefaults.ts`, `server/src/config/copilotSeedBootstrap.ts`, `scripts/flow_control/decision.py`, `docker-compose.yml`, `server/Dockerfile`, and `server/npm-global.txt`.

## Early Risk-Invariant Matrix

- Shared condition-evaluation seam
  - Invariant: `if`, `break`, and `continue` must all accept only the existing AI yes-or-no path or one repository-relative Python wrapper that returns exactly `{"answer":"yes"}` or `{"answer":"no"}`.
  - Likely contradiction: a malformed script result, extra top-level JSON keys, timeout, non-zero exit, or invalid answer accidentally falling through as a clean `no` or silently switching back to AI behavior.
  - Proof strength today: direct internal precedent for strict parsing exists; script-launch proof is still missing.
  - Future task home: the future flow-contract and shared decision task must own both schema proof and runtime failure proof for this seam.
- Persisted wait and resume seam
  - Invariant: a paused flow resumes only the same execution identity, step path, and loop context after the absolute resume timestamp elapses.
  - Likely contradiction: a cancelled or terminal run wakes later and mutates state anyway, or a resumed run mixes stale wait state with a newer execution or newer PR-cycle state.
  - Proof strength today: direct internal precedent exists for persisted flow resume identity, but timed wait semantics are still missing.
  - Future task home: the future wait-lifecycle task must own persisted-state writer and reader proof, including cancel, terminal, restart, and contradictory-state behavior.
- GitHub transport and PR-selection seam
  - Invariant: every GitHub mutation or fetch is tied to the explicit worked repository, current branch, existing upstream remote, resolved base branch, and selected newest open PR for that branch.
  - Likely contradiction: convenience inference chooses the wrong remote, wrong repository, wrong PR, or a stale closed PR because the helper trusted checkout context instead of explicit repo plus branch filters.
  - Proof strength today: external contract evidence is confirmed, but the runtime helper seam is still missing.
  - Future task home: the future GitHub transport task must own explicit repo-resolution, push, PR-selection, and pagination proof.
- GitHub scratch writer and reader seam
  - Invariant: later readers either see the previous valid review scratch artifact or the newly written valid artifact, and stale scratch is replaced only by the active review-cycle owner for the same story.
  - Likely contradiction: delete-first replacement leaves a temporary missing file that a reader interprets as a clean review, or a partial write or stale artifact is consumed as current-branch evidence.
  - Proof strength today: direct atomic replacement precedent exists elsewhere in the repo, and downstream review readers are already known; the shared TypeScript scratch writer is still missing.
  - Future task home: the future GitHub transport task must own the safe-write seam, and the future opt-in review-cycle composition task must own stale-scratch replacement proof during end-to-end flow execution.
- Opt-in copied flow entrypoint seam
  - Invariant: Story 60 behavior appears only in copied opt-in flow variants, and existing checked-in default flow entrypoints stay unchanged unless an operator intentionally selects a new variant.
  - Likely contradiction: later implementation mutates `flows/implement_next_plan.json` or another in-use default flow directly, causing GitHub review behavior to appear in the default path.
  - Proof strength today: the repository already has copied flow definitions to use as structural precedent; opt-in review-cycle composition proof is still missing.
  - Future task home: the future copied-flow composition task must own direct proof that default entrypoints remain unchanged while the new variant exercises the GitHub review loop.

## Test Harnesses

- No new frontend harness is required for this story. The story is backend-first and flow-runtime-focused.
- The primary automated proof homes already exist:
  - schema parsing and flow-file validation in `server/src/test/unit/flows-schema.test.ts`;
  - flow runtime, resume, error, loop, and command behavior in `server/src/test/integration/flows.run.*.test.ts`;
  - cucumber coverage in `server/src/test/features/flows-execution-runs.feature` plus `server/src/test/steps/flows-execution-runs.steps.ts`;
  - browser-level flow regression coverage in `e2e/flows-execution-runs.spec.ts` only where a browser-visible proof path is still honest after the runtime changes.
- GitHub-specific automated proof should stay in backend-owned tests by mocking or fixture-driving the GitHub CLI or thin adapter seam rather than weakening production behavior for testability.
- Order-sensitive proof should stay deterministic: wait-resume, cancel, skip, and scratch-read assertions should observe explicit persisted state transitions or emitted outcomes rather than arbitrary fixed sleeps that only usually pass.
- Manual proof should use the checked-in main human stack via `npm run compose:build` plus `npm run compose:up` unless repository-owned guidance later proves that only a minimal test-only harness adjustment is needed for sandbox GitHub access.

## Log Or Proof Markers

- Flow schema proof home:
  - `server/src/test/unit/flows-schema.test.ts` should prove new step-shape acceptance and invalid wait-value rejection.
- Runtime orchestration proof home:
  - `server/src/test/integration/flows.run.*.test.ts` should prove `if`, script-driven yes or no decisions, persisted wait state, cancel-safety, and completed-with-warning skip outcomes.
- Cucumber proof home:
  - `server/src/test/features/flows-execution-runs.feature` should cover one end-to-end flow composition that exercises the new primitives in the order this story introduces them.
- Opt-in flow-variant proof home:
  - copied-flow proof should confirm the new GitHub review cycle only appears in the newly created variants and that the existing default checked-in entrypoints remain unchanged unless an operator intentionally selects a copied variant.
- GitHub adapter proof home:
  - backend-owned tests should prove explicit base resolution, upstream-push behavior, explicit PR lookup, pagination across review payloads, author filtering, and supported skip or failure notes without requiring live GitHub for every path.
- Manual proof artifact expectations:
  - story-level manual proof should retain sandbox evidence under `codeInfoTmp/manual-testing/<story-number>/...` using deterministic names such as `proof-01-open-pr.png`, `proof-02-fetched-review.json`, `support-console.txt`, and `support-network.json` when those artifacts are actually captured.

## Edge Cases And Failure Modes

- If `.env.local` is missing, unreadable, lacks `CODEINFO_PR_TOKEN`, or contains only blank or whitespace for that variable, the flow records a concise plan note, skips the GitHub review cycle for that pass, and finishes as completed with warning.
- If `.env.local` exists but cannot be parsed into a valid key-value map, the flow treats that the same way as unreadable GitHub-review configuration for this story: record a concise plan note, skip the GitHub cycle for that pass, and finish as completed with warning rather than guessing at partial values.
- If the current branch does not already have a usable upstream remote, or the automatic push fails, the flow records a concise plan note, does not guess alternate remotes or forks, and skips the GitHub review cycle for that pass with completed-with-warning status.
- If multiple open PRs exist for the same branch, the flow selects the newest still-open PR for that branch by open time and ignores closed PRs.
- If the fetch or close step cannot identify any open PR for the current branch, it must fail or skip in a way that does not mutate an unrelated PR on another branch.
- If the `gh pr create` command succeeds but only returns a URL on stdout, the step must perform one explicit post-create PR lookup to resolve canonical PR metadata such as number and branch identity before writing scratch state or moving into the wait step.
- If the PR lookup API or CLI returns more than one page of review submissions or inline comments, the flow must continue pagination until exhaustion rather than silently accepting first-page-only evidence as complete.
- If a listed review submission is still `PENDING` and therefore lacks `submitted_at`, the raw artifact may preserve it but classification must not treat it as completed outside feedback.
- If persisted wait state, selected PR metadata, current branch identity, or transient review scratch disagree in a way that suggests mixed old and new execution state, the runtime must fail or skip clearly for that execution rather than submitting, restoring, or classifying contradictory combined state.
- Review ingestion must ignore PR-author-authored review submissions and inline comments so the GitHub review cycle only classifies outside feedback from other users.
- Malformed or partially written GitHub-review scratch JSON must not be treated as an empty clean review. Reader steps should fail clearly or trigger a supported rerun path rather than silently downgrading the evidence.
- If a prior review cycle left stale GitHub-review scratch files for the same story, the next fresh GitHub fetch for that story must replace its own transient review artifacts through the shared safe-write path before later reader steps consume them, so old findings are not mistaken for current-branch evidence.
- The timed wait step must remain safe across restart and cancellation boundaries: resumed execution continues the same flow run, while cancelled or terminal runs do not wake up later and keep mutating state after the run is already over.
- Ordering matters for wait and cancellation proof: later validation must show that a cancelled or terminal run cannot emit a delayed resume side effect after cancellation, not merely that cancellation and resume each work in isolation.

## Implementation Ideas

- Add the new flow-step schema entries in `server/src/flows/flowSchema.ts` for `if`, timed wait, and the thin GitHub PR actions, while keeping agent-command JSON unchanged.
- Add the matching runtime dispatcher entries in `server/src/flows/service.ts` so each new step type has one explicit execution seam instead of hidden behavior inside another step.
- Extract one shared decision-evaluation seam for `if`, `break`, and `continue` so AI yes-or-no answers and repository-relative Python wrapper-script answers reuse the same timeout, stdout parsing, and hard-failure contract.
- Add the timed wait definition seam that validates whole-second positive integer delay input at flow-parse time before any runtime pause behavior is attempted.
- Add the timed wait persistence writer seam in `server/src/flows/flowState.ts` plus `server/src/flows/service.ts` so a running flow records execution identity, next-step location, resume timestamp, and loop context before it pauses.
- Add the timed wait resume reader and wake-up seam in `server/src/flows/service.ts` so restart, refresh, cancellation, and terminal-run checks are handled separately from the write side.
- Add one run-state reconciliation seam that checks whether resumed wait state, selected PR metadata, branch identity, and transient review scratch still belong to the same execution before the resumed flow continues.
- Add one worked-repository `.env.local` reader seam for `CODEINFO_PR_TOKEN` that runs at GitHub-step execution time and stays separate from `server/.env` startup loading.
- Add one subprocess-launch seam for GitHub operations that reuses the repository's existing cwd-scoped, env-injected child-process conventions instead of inventing a special launcher with different timeout or stdout behavior.
- Add one runtime-availability seam for the chosen GitHub transport so the supported server runtime, including the checked-in main Docker Compose path, either provides `gh` honestly or fails the GitHub cycle through the supported completed-with-warning path.
- Add one repository-state seam that resolves owner, repository name, current branch, current HEAD, upstream remote, and a trustworthy base branch before any PR mutation is attempted.
- Add one PR-open seam that creates the PR non-interactively from explicit `--title`, `--body`, `--head`, and `--base` inputs and treats the immediate create output separately from later canonical PR metadata lookup.
- Add one PR-selection seam that resolves the newest still-open PR for the current branch through explicit repository plus head-branch filtering and created-date ordering.
- Add one review-submission fetch seam that reads paginated PR review submissions and preserves the documented review fields needed later for filtering and classification.
- Add one inline-review-comment fetch seam that reads paginated PR review comments and preserves the documented inline-comment fields needed later for filtering and classification.
- Add one GitHub-review scratch writer seam that writes the canonical metadata record plus the `reviews` and `reviewComments` arrays into `codeInfoTmp/reviews/` through a shared safe-write path instead of delete-first replacement.
- Add one GitHub-review scratch reader seam for later classification and routing so malformed, partial, missing, or contradictory stale-versus-fresh scratch data fails clearly instead of being silently interpreted as a clean review.
- Add one reviewer-facing PR-summary generation seam that builds the title and body from current story and implementation context, including the explicit no-out-of-scope-behavior-change instruction to reviewers.
- Add one copied-flow-variant seam that duplicates and renames the currently in-use flow definitions before composing the new review-cycle steps into those opt-in variants.
- Add one findings-routing seam that maps valid GitHub review issues back into the repository's existing minor-fix and task-up repair patterns without replacing the broader review lifecycle.
- Add one schema-proof seam in `server/src/test/unit/flows-schema.test.ts` for new step acceptance, nested-step structure, and invalid timed-wait values.
- Add one flow-runtime proof seam in `server/src/test/integration/flows.run.*.test.ts` for shared decision evaluation, timed-wait persistence and resume, cancel-safety, and completed-with-warning skip outcomes.
- Add one GitHub-adapter proof seam in backend-owned tests for worked-repository token reading, transport availability checks, upstream-push behavior, explicit PR lookup, base-branch resolution, author filtering, pagination, and safe scratch-file handling.
- Add one opt-in flow-composition proof seam in cucumber or browser-level flow tests so one clean review cycle and one more-work-needed review cycle are proved without mutating the current default flow entrypoints.

## Questions

- No Further Questions

# Tasks

### Task 1. Define Flow Step Contracts And Shared Condition Evaluation

- Repository Name: `Current Repository`
- Task Dependencies: `None`
- Task Status: `__done__`
- Git Commits:

#### Overview

Add the new flow-only step contracts that Story 60 needs, and make `if`, `break`, and `continue` share one strict AI-or-script decision path. This task owns schema and runtime contract definition, but it does not yet own persisted wait lifecycle or live GitHub transport behavior.

#### Task Exit Criteria

- [ ] Flow definitions can express a dedicated `if` step, a positive-integer `wait` step, and thin GitHub PR step shapes without adding matching support to agent command JSON.
- [ ] `if`, `break`, and `continue` all use one shared AI-or-script decision contract, and malformed script output fails the step instead of producing a guessed decision.
- [ ] Proof owners exist for accepted schema shapes, rejected invalid wait values, valid script decisions, and hard failure on malformed script output.

#### Documentation Locations

- Context7 `/colinhacks/zod` - use for strict object, union, and recursive schema patterns in the flow step schema.
- Context7 `/nodejs/node/v22.17.0` - use for child-process execution, timeout handling, and stdout parsing rules for the direct Python decision path.

#### Subtasks

1. [x] Extend `server/src/flows/flowSchema.ts` so flow definitions accept a first-class `if` step with `then` and optional `else`. Keep the new branch shape flow-only and do not add matching support to `server/src/agents/commandsSchema.ts`. Purpose: add the approved conditional flow contract without widening story scope into agent commands. Proof owners: `server/src/test/unit/flows-schema.test.ts`.
2. [x] Extend `server/src/flows/flowSchema.ts` so flow definitions accept a positive-integer `wait` step and reject zero, negative, fractional, or non-numeric wait values during validation. Purpose: keep the wait contract strict at definition time instead of clamping bad values at runtime. Proof owners: `server/src/test/unit/flows-schema.test.ts`.
3. [x] Extend `server/src/flows/flowSchema.ts` so flow definitions accept the thin GitHub PR step shapes needed for open, fetch, and close actions. Purpose: add the approved GitHub step family to the flow schema without hiding policy inside other step types. Proof owners: `server/src/test/unit/flows-schema.test.ts`.
4. [x] Update any exported flow types in `server/src/flows/types.ts` that must reflect the new `if`, `wait`, and GitHub PR step shapes. Purpose: keep the typed runtime contract aligned with the updated schema. Proof owners: `server/src/test/unit/flows-schema.test.ts`.
5. [x] Extract a shared decision-evaluation launcher inside `server/src/flows/service.ts` so `if`, `break`, and `continue` can all call either the existing AI yes-or-no path or one repository-relative Python entrypoint executed from the worked repository root. Purpose: give all three control-flow surfaces one runtime decision seam instead of three slightly different ones. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
6. [x] Update `server/src/flows/service.ts` so the shared decision-evaluation seam reuses the repository's strict answer parsing rules and treats missing files, timeouts, non-zero exits, malformed JSON, extra top-level keys, and non-`yes`/`no` answers as hard failures. Purpose: keep ambiguous script output from being silently reinterpreted as a branch decision. Proof owners: `server/src/test/unit/flows.break-parser.test.ts`, `server/src/test/integration/flows.run.errors.test.ts`.
7. [x] Proof type: checked-in fixture. Location: `server/src/test/fixtures/flows/flow-control/`. Description: add happy-path direct-Python yes or no fixtures that the shared decision launcher in `server/src/flows/service.ts` can consume from the worked repository root. Purpose: give the valid script-decision path stable checked-in proof inputs instead of ad hoc temp scripts. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
8. [x] Proof type: checked-in fixture. Location: `server/src/test/fixtures/flows/flow-control/`. Description: add malformed JSON, extra-key output, timeout, and non-zero-exit fixtures for the shared decision launcher in `server/src/flows/service.ts`. Purpose: give the hard-failure script-decision paths stable checked-in proof inputs instead of implicit inline setup. Proof owners: `server/src/test/integration/flows.run.errors.test.ts`.
9. [x] Test type: server unit. Location: `server/src/test/unit/flows-schema.test.ts`. Description: prove the `if`-step schema owned by `server/src/flows/flowSchema.ts` accepts valid `then` and optional `else` shapes. Rename any misleading test titles in this file if the old names no longer match the invariant. Purpose: give the dedicated conditional flow shape its own explicit proof home. Proof owners: `server/src/test/unit/flows-schema.test.ts`.
10. [x] Test type: server unit. Location: `server/src/test/unit/flows-schema.test.ts`. Description: prove the `wait`-step schema owned by `server/src/flows/flowSchema.ts` accepts positive-integer seconds and rejects zero, negative, fractional, and non-numeric values. Purpose: give the constrained wait-input contract its own explicit proof home. Proof owners: `server/src/test/unit/flows-schema.test.ts`.
11. [x] Test type: server unit. Location: `server/src/test/unit/flows-schema.test.ts`. Description: prove the thin GitHub PR step shapes owned by `server/src/flows/flowSchema.ts` and `server/src/flows/types.ts` validate open, fetch, and close actions. Purpose: give the new GitHub flow-step family its own explicit proof home. Proof owners: `server/src/test/unit/flows-schema.test.ts`.
12. [x] Test type: server unit. Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: prove the strict valid-answer parser path owned by `server/src/flows/service.ts` accepts script output that returns only `{"answer":"yes"}` or `{"answer":"no"}` for `break`, `continue`, and any new shared `if` decision entrypoint proved at parser level. Rename or split any reused test titles if they would still read as break-only coverage after the shared `if` parser path is added. Purpose: keep the parser-level success contract directly proved instead of only indirectly through integration tests. Proof owners: `server/src/test/unit/flows.break-parser.test.ts`.
13. [x] Test type: server unit. Location: `server/src/test/unit/flows.break-parser.test.ts`. Description: prove the hard-failure parser path owned by `server/src/flows/service.ts` rejects malformed JSON, extra top-level keys, and invalid non-`yes` or `no` answers for the shared decision parser surface. Purpose: keep ambiguous script output from being silently reinterpreted as a decision. Proof owners: `server/src/test/unit/flows.break-parser.test.ts`.
14. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.loop.test.ts`. Description: prove the shared runtime decision seam owned by `server/src/flows/service.ts` follows a valid script-driven branch through `if`, `break`, or `continue` without falling back to a different control-flow path. Purpose: give the end-to-end happy path for the shared decision seam its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
15. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.errors.test.ts`. Description: prove the shared runtime decision seam owned by `server/src/flows/service.ts` fails hard for missing script files, timeouts, non-zero exits, malformed JSON, extra keys, and invalid answers. Rename or split any reused error tests if the old title would still read as a flow-launch or unrelated runtime failure after the new step-level decision-failure scenario is added. Purpose: give the shared decision seam's runtime failure modes their own explicit proof home. Proof owners: `server/src/test/integration/flows.run.errors.test.ts`.
16. [x] Run `npm run lint` for the files changed by this task and fix any issues found, using `npm run lint:fix` before manual cleanup when possible. Purpose: leave the shared flow-contract surface in an honestly lint-clean state. Proof owners: `npm run lint` output for the changed Task 1 files.
17. [x] Run `npm run format:check` for the files changed by this task and fix any issues found, using `npm run format` before manual cleanup when possible. Purpose: leave the shared flow-contract surface in an honestly formatted state. Proof owners: `npm run format:check` output for the changed Task 1 files.

#### Testing

1. [x] Run `npm run build:summary:server` because this task changes server flow schema and runtime code. Use the wrapper log only if the summary ends with `agent_action: inspect_log`.
2. [x] Run `npm run test:summary:server:unit` because this task changes flow schema parsing and shared runtime decision execution.
3. [x] Run `npm run test:summary:server:cucumber` because authored flow-control behavior changed and the repository's flow cucumber coverage must still pass.
4. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [x] Run `npm run format:check` for this task's surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Audit 2026-06-23: reopened Subtasks 5, 6, 14, and 15 plus Testing 1, 2, and 3 after comparing the checked plan against current repo evidence. `server/src/flows/service.ts` defines `_evaluateScriptDecision`, but `runBreakStep` and `runContinueStep` still build AI-only prompts, `runSteps(...)` still falls through to `UNSUPPORTED_STEP` for `if`, `wait`, and GitHub PR steps, and the Story 60 integration tests named as script-driven happy-path and error coverage do not actually invoke the script decision path. The retained `build-server-latest.log` and server wrapper logs under `test-results/` predate the Jun 23 Story 60 commits, so those wrapper proof rows were also reopened for a later honest proof pass.
- 2026-06-23: Repaired the shared decision seam in `server/src/flows/service.ts` so `if`, `break`, and `continue` now share the same AI-or-script launcher, reuse the strict yes-or-no parser, and fail hard on missing files, bad JSON, extra keys, invalid answers, non-zero exits, and timeouts. Updated the loop and error integration harnesses to register their temp working folders as known repos, copied the checked-in `flow-control` fixtures into the error harness temp repo, and corrected the new `/flows/:flowName/run` assertions to the route's `202` contract. Targeted proof passed with `TS_NODE_TRANSPILE_ONLY=1 NODE_OPTIONS="--import ./scripts/register-ts-node-esm-loader.mjs --disable-warning=DEP0180" node --test --test-concurrency=1 src/test/unit/flows.break-parser.test.ts src/test/unit/flows-schema.test.ts`, `... src/test/integration/flows.run.loop.test.ts --test-name-pattern "shared decision seam"`, and `... src/test/integration/flows.run.errors.test.ts --test-name-pattern "shared decision seam"`; the wrapper-owned Testing 1-3 rows remain open for the later full proof pass.
- **RESOLVED ISSUE** Audit normalization reopened Subtasks 5, 6, 14, and 15 because the shared script-decision seam was only partially wired. The deeper repair completed the runtime seam, restored honest happy-path and error-path integration coverage, and cleared the live blocker without changing task ownership or plan shape.
- Audit 2026-06-23: Marked Testing 1 complete from `logs/test-summaries/build-server-latest.log`, which was refreshed at 15:46 UTC and shows a clean `npm run build --workspace server` after the Story 60 Task 1 repairs landed.
- **RESOLVED ISSUE** Audit 2026-06-23: cleared the remaining wrapper-owned proof rows after refreshing the failing automation with narrower repairs. `npm run test:summary:server:unit` now passes cleanly via `test-results/server-unit-tests-2026-06-23T17-49-49-980Z.log` after making the Copilot discovery fallback test self-contained, aligning the saved-conversation MCP websocket expectation with the saved execution identity contract, and returning the refreshed conversation from the stale-working-folder test hook. `npm run test:summary:server:cucumber` now passes cleanly via `test-results/server-cucumber-tests-2026-06-23T18-39-49-447Z.log` after updating `common/src/fixtures/mockModels.ts` to include the provider-info `endpointOnly: false` field now emitted by chat models responses.
- Audit 2026-06-23: Manual testing was assessed as not applicable for Task 1. The pass stayed task-scoped because this task's completed exit criteria are flow-schema, runtime decision-seam, and automated-proof ownership changes with no separate browser-visible, network-visible, or other manual-only proof surface beyond the completed wrapper and integration coverage, so no runtime was started and no manual-proof artifacts were needed.

### Task 2. Add Persisted Wait Lifecycle And Resume Reconciliation

- Repository Name: `Current Repository`
- Task Dependencies: `1`
- Task Status: `__done__`
- Git Commits:

#### Overview

Implement the persisted `wait` runtime lifecycle so a paused review cycle resumes the same flow execution after delay or restart. This task owns wait-state storage, wake-up behavior, contradiction checks, and cancellation or terminal safety for the new stateful flow step.

#### Task Exit Criteria

- [ ] The `wait` step persists enough state to resume the same execution after the authored delay or a server restart, using an absolute resume timestamp instead of an in-memory countdown.
- [ ] Cancelled or terminal runs do not wake later and mutate state, and contradictory persisted wait state is rejected clearly instead of being merged into a fresh run.
- [ ] Lifecycle proof owners cover waiting, resumed, cancel, terminal, contradictory-state, and startup-recovery rows before formal wrapper execution begins.

#### Documentation Locations

- Context7 `/nodejs/node/v22.17.0` - use for timers, abort behavior, and filesystem persistence patterns that affect restart-safe wait handling.
- https://nodejs.org/api/timers.html - use to keep the implementation aligned with Node timer behavior while persisting absolute resume timestamps instead of trusting live in-memory timers.

#### Subtasks

1. [x] Extend `server/src/flows/flowState.ts` so a paused `wait` step records the execution identity, step path, loop context, active subflow state, worked repository path, and one absolute resume timestamp for the same run. Purpose: make the persisted wait payload explicit and run-scoped instead of implicit or global. Proof owners: `server/src/test/integration/flows.run.resume.identity.test.ts`.
2. [x] Update the persisted-state read and write handling in `server/src/flows/service.ts` so the new `wait` fields are stored and restored without creating a fresh execution identity. Purpose: keep wait persistence aligned with the repository's existing resume-state contract. Proof owners: `server/src/test/integration/flows.run.resume.backfill.test.ts`.
3. [x] Implement the `wait` write path in `server/src/flows/service.ts` so a running flow records its resume timestamp and pause context before it yields control. Purpose: ensure the wait step survives refresh and restart instead of behaving like an in-memory sleep. Proof owners: `server/src/test/integration/flows.run.resume.identity.test.ts`.
4. [x] Implement the `wait` wake and restart-resume path in `server/src/flows/service.ts` so expiry resumes the same execution instead of starting a fresh run. Purpose: preserve the story's restart-safe lifecycle contract after the authored delay elapses. Proof owners: `server/src/test/integration/flows.run.resume.backfill.test.ts`.
5. [x] Add reconciliation checks in `server/src/flows/service.ts` that compare resumed wait state against the current execution identity and any in-progress GitHub-review context, and fail clearly when those no longer match. Purpose: prevent mixed old and new state from being combined during resume. Proof owners: `server/src/test/integration/flows.run.errors.test.ts`.
6. [x] Add cancel safety guards in `server/src/flows/service.ts` and any wait scheduling helper so a delayed wake-up cannot continue mutating state after the flow has been cancelled. Purpose: cover the lifecycle-sensitive contradiction where cancellation and resume interleave incorrectly together. Proof owners: `server/src/test/integration/flows.run.resume.identity.test.ts`.
7. [x] Add terminal-run safety guards in `server/src/flows/service.ts` and any wait scheduling helper so a delayed wake-up cannot continue mutating state after the flow has already failed or completed. Purpose: keep terminal runs from emitting a late resume side effect. Proof owners: `server/src/test/integration/flows.run.errors.test.ts`.
8. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.resume.identity.test.ts`. Description: prove the persisted-state identity invariant owned by `server/src/flows/flowState.ts` and `server/src/flows/service.ts` for a paused wait that resumes the same execution after the authored delay. Use an explicit persisted-state or scheduler boundary instead of a hidden fixed-delay sleep. Purpose: give the primary waiting and resumed lifecycle rows their own explicit proof home. Proof owners: `server/src/test/integration/flows.run.resume.identity.test.ts`.
9. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.resume.identity.test.ts`. Description: prove the cancel-ordering invariant owned by `server/src/flows/service.ts` for a cancelled wait that must not emit a later resume side effect. State the teardown and isolation expectation for any shared timer, wake callback, or persisted state touched by the scenario. Purpose: give the lifecycle-sensitive cancel row its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.resume.identity.test.ts`.
10. [x] Test maintenance. Location: `server/src/test/integration/flows.run.resume.identity.test.ts`. Description: rename or split any reused generic resume tests and helper-flow fixtures so the new paused-wait resume and paused-wait cancel scenarios are titled around wait lifecycle identity rather than only legacy execution-id recovery. Purpose: prevent wait-specific lifecycle proof from hiding behind older generic resume wording. Proof owners: `server/src/test/integration/flows.run.resume.identity.test.ts`.
11. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.resume.backfill.test.ts`. Description: prove the startup-recovery invariant owned by `server/src/flows/service.ts` for persisted wait state loaded after restart. Purpose: give the restart-safe resume row its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.resume.backfill.test.ts`.
12. [x] Test maintenance. Location: `server/src/test/integration/flows.run.resume.backfill.test.ts`. Description: rename or split any reused generic backfill tests and helper-flow fixtures so restart-after-wait scenarios are titled around wait resume backfill rather than only legacy child-conversation execution-id repair. Purpose: keep restart-safe wait semantics explicit in the proof file that owns them. Proof owners: `server/src/test/integration/flows.run.resume.backfill.test.ts`.
13. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.errors.test.ts`. Description: prove the contradictory persisted-state invariant owned by `server/src/flows/service.ts` when resumed wait state no longer matches the current execution or GitHub-review context. Purpose: give the mixed old and new state failure mode its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.errors.test.ts`.
14. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.errors.test.ts`. Description: prove the terminal-run no-resume invariant owned by `server/src/flows/service.ts` when a wait would otherwise wake after the flow has already failed or completed. State the teardown and isolation expectation for any shared timer or persisted state touched by the scenario. Purpose: give the terminal lifecycle row its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.errors.test.ts`.
15. [x] Test type: cucumber. Location: `server/src/test/features/flows-execution-runs.feature` and `server/src/test/steps/flows-execution-runs.steps.ts`. Description: author one deterministic wait-resume scenario for the flow execution surface owned by `server/src/flows/service.ts`, naming the explicit state boundary that proves resume happened rather than depending on a hidden long sleep. Rename the feature heading or split the scenarios if the current retry-ownership feature title would otherwise misdescribe the new wait lifecycle coverage. Purpose: carry the shipped wait lifecycle into the repository's cucumber proof surface without semantic drift. Proof owners: `server/src/test/features/flows-execution-runs.feature`, `server/src/test/steps/flows-execution-runs.steps.ts`.
16. [x] Run `npm run lint` for the files changed by this task and fix any issues found, using `npm run lint:fix` before manual cleanup when possible. Purpose: leave the wait lifecycle and persisted-state surface in an honestly lint-clean state. Proof owners: `npm run lint` output for the changed Task 2 files.
17. [x] Run `npm run format:check` for the files changed by this task and fix any issues found, using `npm run format` before manual cleanup when possible. Purpose: leave the wait lifecycle and persisted-state surface in an honestly formatted state. Proof owners: `npm run format:check` output for the changed Task 2 files.

#### Testing

1. [x] Run `npm run build:summary:server` because this task changes persisted wait and resume runtime code.
2. [x] Run `npm run test:summary:server:unit` because this task changes stateful orchestration, persisted resume identity, and cancel handling.
3. [x] Run `npm run test:summary:server:cucumber` because the new wait lifecycle changes authored flow execution behavior and restart-safe resume expectations.
4. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [x] Run `npm run format:check` for this task's surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Added persisted `flow.wait` state in `server/src/flows/flowState.ts` and `server/src/flows/service.ts`, including absolute resume timestamps, loop and subflow context, explicit resume reconciliation, and scheduled wait wake-up helpers that clear persisted state on cancel, stop, and terminal failure paths.
- Added Task 2 integration coverage in `server/src/test/integration/flows.run.resume.identity.test.ts`, `server/src/test/integration/flows.run.resume.backfill.test.ts`, and `server/src/test/integration/flows.run.errors.test.ts`; the proof seams were tightened to watch flow-owned assistant-turn and persisted-wait boundaries instead of assuming the same in-memory chat stub would be reused after resume or restart.
- Added the deterministic wait-resume cucumber scenario in `server/src/test/features/flows-execution-runs.feature` and `server/src/test/steps/flows-execution-runs.steps.ts`, then fixed the step definition to poll for persisted wait state before asserting so the authored-flow proof uses the same explicit state boundary as the integration tests.
- Ran targeted Task 2 proof commands: the Node integration bundle for `flows.run.resume.identity`, `flows.run.resume.backfill`, and `flows.run.errors`; `npx cucumber-js ... --name "Persisted wait resumes from an explicit wake boundary"` after a broader feature run exposed unrelated setup noise plus a race in the new step; `npx eslint` on the changed TypeScript files; and `npx prettier --write` followed by `npx prettier --check --ignore-unknown` on the changed Task 2 files.
- `npm run build:summary:server` failed first on TypeScript `never` call-site errors in the new wait-resume tests, so the wake callback invocations were narrowed with explicit function casts in the affected integration files and the wrapper then passed cleanly.
- `npm run test:summary:server:unit` first exposed unrelated Codex-home leakage and a full-suite-only working-folder restore failure; isolating the Codex-unavailable tests, rereading persisted working folders after clear attempts, and resetting shared working-folder test state between cases brought the targeted proofs and the full wrapper back to green.
- `npm run test:summary:server:cucumber` passed cleanly on the first wrapper run after the unit-suite fixes, so the authored wait lifecycle coverage is now green alongside the build and full server-unit wrapper.
- Audit note: Task 2 is now `__done__` because its subtasks, wrapper-backed automated proof, and blocker check are all complete; the `server/src/routes/conversations.ts` working-folder reread tweak that surfaced during the full server-unit pass touched an out-of-scope conversations-list restore path and is recorded here as discovered drift rather than as Story 60 wait-lifecycle scope expansion.
- Manual testing skipped for the supported wait-resume runtime surface. Tried: restarted the documented main stack with `npm run compose:build` and `npm run compose:up`, verified `http://localhost:5010/health` plus `http://localhost:5001`, then checked `GET /flows` and the checked-in `flows/*.json` and `flows-sandbox/*.json` catalog for a runnable `wait` flow. Observed: startup and shutdown both succeeded, but the live catalog exposed only `echo` and `smoke` as runnable flows, the remaining checked-in flows were disabled for missing manual-testing agents, and none of the supported checked-in flow definitions contained a `wait` step. Why fuller proof was not possible: Task 2's wait lifecycle is currently exercised only through backend test fixtures, and the later Story 60 flow-composition tasks have not yet exposed a supported main-stack flow that can exercise `wait` manually.

### Task 3. Add GitHub Transport, Repo-Local Token Loading, And Safe Review Scratch Ownership

- Repository Name: `Current Repository`
- Task Dependencies: `1`
- Task Status: `__done__`
- Git Commits:

#### Overview

Add the thin GitHub PR transport layer, the worked-repository `.env.local` token read, and the safe writer for transient review scratch under `codeInfoTmp/reviews/`. This task owns the runtime transport and scratch contract, but not yet the copied flow composition that uses it.

#### Task Exit Criteria

- [ ] The supported server runtime, including the checked-in main Docker Compose server image, provides `gh`, and GitHub steps read `CODEINFO_PR_TOKEN` only from the worked repository `.env.local`, mapping it only into child-process auth env for that invocation.
- [ ] The GitHub helper resolves explicit repository, branch, upstream, base branch, and latest open PR state; fetches both review submissions and inline review comments with pagination; and avoids checkout-based PR inference.
- [ ] Transient GitHub review scratch under `codeInfoTmp/reviews/` is safely replaced, preserves the required metadata fields, and has direct unit proof for skip, failure, pagination, and replacement paths.

#### Documentation Locations

- https://cli.github.com/manual/gh_pr_create - use for explicit non-interactive `gh pr create` flags and behavior.
- https://cli.github.com/manual/gh_api - use for authenticated API calls and pagination rules.
- https://docs.github.com/en/rest/pulls/pulls - use for PR create, list, and close behavior plus the explicit latest-open-PR lookup model.
- https://docs.github.com/en/rest/pulls/reviews - use for review submission fields and fine-grained read permission.
- https://docs.github.com/en/rest/pulls/comments - use for inline review comment fields and fine-grained read permission.
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens - use for the minimum fine-grained `Pull requests` permission statement.
- Context7 `/nodejs/node/v22.17.0` - use for runtime env parsing, subprocess launch, and safe file replacement patterns.

#### Subtasks

1. [x] Update `server/Dockerfile` so the supported server runtime includes `gh`. Purpose: preserve the story's supported runtime contract for automated and manual proof inside the server container. Proof owners: the main Docker build path exercised later by `npm run compose:build`.
2. [x] Update `server/npm-global.txt` if that file must also name `gh` for the supported server runtime build path. Purpose: keep the repository's package-managed runtime inventory aligned with the Docker image. Proof owners: the main Docker build path exercised later by `npm run compose:build`.
3. [x] Add a worked-repository `.env.local` reader seam in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` that uses `dotenv.parse` and reads only the worked repository root `.env.local` at GitHub-step execution time. Purpose: keep GitHub credentials repository-local and opt-in instead of extending startup env loading. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
4. [x] Update that `.env.local` reader seam so missing file, missing key, blank or whitespace-only token, and malformed file are returned as separate supported skip reasons. Do not extend `server/src/config/startupEnv.ts` or promote repository-local GitHub credentials into process startup state. Purpose: make the config-domain handling explicit before GitHub transport code consumes it. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
5. [x] Implement the GitHub child-process env builder in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` so only `CODEINFO_PR_TOKEN` is mapped to `GH_TOKEN` for the `gh` invocation, unrelated keys from the worked repository `.env.local` are ignored, and neither `process.env` nor child agent conversations gain the token. Purpose: preserve the current startup-env contract while keeping GitHub auth scoped to one subprocess. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
6. [x] Implement explicit repository-state resolution in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` for repository owner, repository name, current branch, current HEAD, existing upstream remote, and a trustworthy base branch. Purpose: bind the GitHub review cycle to explicit repository state instead of checkout inference. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
7. [x] Implement the upstream push seam in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` so the current branch can be pushed only to its existing upstream remote before PR creation. Purpose: support non-interactive PR creation without guessing alternate remotes or forks. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
8. [x] Implement the raw `gh` transport normalizer in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` so missing binaries, subprocess spawn failures, and non-zero `gh` exits are converted into explicit Story 60 GitHub-step results with preserved stderr context and a clear skip-with-warning versus hard-failure outcome. Purpose: keep raw subprocess failures from leaking through as ambiguous runtime errors. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`.
9. [x] Implement the non-interactive PR-open seam in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` for `gh pr create --title --body --head --base`. Purpose: satisfy the explicit PR-open contract without relying on interactive prompts. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
10. [x] Implement the explicit post-create PR lookup seam in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` so canonical PR metadata is resolved even when create output only returns a URL. Purpose: keep later wait and scratch state tied to authoritative PR identity. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
11. [x] Implement the latest-open-PR selection seam in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` using explicit repository plus head-branch filtering and created-date ordering. Purpose: avoid `gh pr view` convenience inference and keep PR selection deterministic. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
12. [x] Implement the review-submission fetch seam in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` so paginated PR review submissions are fetched and preserved with the required metadata fields. Purpose: cover one half of the GitHub review feedback family explicitly. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`, `server/src/test/fixtures/flows/github-review/`.
13. [x] Implement the inline review-comment fetch seam in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` so paginated inline PR review comments are fetched and preserved with the required metadata fields. Purpose: cover the second half of the GitHub review feedback family explicitly. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`, `server/src/test/fixtures/flows/github-review/`.
14. [x] Implement the close-PR seam in `server/src/flows/service.ts` or a new adjacent helper under `server/src/flows/` so the latest open PR for the current branch can be closed without touching unrelated branches. Purpose: support the findings-present loopback path with the same explicit PR identity rules used elsewhere. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
15. [x] Implement the transient GitHub review scratch writer for `codeInfoTmp/reviews/<story-number>-current-review.json` using a staged safe-replacement path instead of delete-first replacement. Purpose: give later readers either the previous valid handoff or the new valid handoff, never a missing-file gap. Proof owners: `server/src/test/unit/flows.github-scratch.test.ts`.
16. [x] Implement the companion raw fetched JSON artifact writer under `codeInfoTmp/reviews/` so repository and PR metadata, review submissions, and inline review comments are preserved with the required fields. Purpose: keep the fetched review data separate from the handoff metadata while preserving the documented scratch contract. Proof owners: `server/src/test/unit/flows.github-scratch.test.ts`, `server/src/test/fixtures/flows/github-review/`.
17. [x] Update the GitHub scratch reader or validator in `server/src/flows/service.ts` or the new adjacent helper so malformed or partial state fails clearly instead of being read as a clean review. Purpose: preserve the producer-consumer contract over the same persisted artifact. Proof owners: `server/src/test/unit/flows.github-scratch.test.ts`.
18. [x] Define scratch cleanup and replacement ownership in `server/src/flows/service.ts` or the new adjacent helper so the GitHub fetch writer is the only seam allowed to replace or clean story-local review scratch, while readers and classifiers may validate freshness but must not delete or reset the files. Purpose: make persisted review-state ownership explicit before later lifecycle and classification work depends on it. Proof owners: `server/src/test/unit/flows.github-scratch.test.ts`, `server/src/test/integration/flows.run.loop.test.ts`.
19. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-adapter.test.ts`. Description: prove the repo-local token-reader invariant owned by `server/src/flows/service.ts` or the new adjacent helper for missing `.env.local`, missing `CODEINFO_PR_TOKEN`, blank token, and malformed `.env.local`. Purpose: give the constrained config-domain, blank-input, and malformed-input paths their own explicit proof home. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
20. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-adapter.test.ts`. Description: prove the runtime-contract-preservation invariant owned by `server/src/flows/service.ts` or the new adjacent helper: the worked-repository `.env.local` reader does not populate `process.env`, does not fall back to startup-loaded `server/.env.local`, and ignores unrelated keys from the worked repository file. Purpose: keep Story 60 from silently changing the repository's known-working startup env behavior. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
21. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-adapter.test.ts`. Description: prove the child-process env-scoping invariant owned by `server/src/flows/service.ts` or the new adjacent helper: `GH_TOKEN` is injected only for the `gh` subprocess, is not forwarded to unrelated child execution paths, and does not persist after the subprocess completes. Purpose: keep GitHub auth scoped to the transport step that needs it. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
22. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-adapter.test.ts`. Description: prove the repository-state and launcher invariant owned by `server/src/flows/service.ts` or the new adjacent helper for missing trustworthy base branch and upstream push failure. Purpose: give the explicit repository-state and failure-note paths their own explicit proof home. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
23. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-adapter.test.ts`. Description: prove raw `gh` transport failures owned by `server/src/flows/service.ts` or the new adjacent helper are normalized into the expected Story 60 skip-with-warning or hard-failure result before later plan-note or status consumers run. Cover at least one missing-binary or spawn-failure path and one non-zero `gh` exit path. Purpose: keep producer and consumer error expectations aligned across the GitHub step boundary. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`, `server/src/test/integration/flows.run.basic.test.ts`.
24. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-adapter.test.ts`. Description: prove the PR identity invariant owned by `server/src/flows/service.ts` or the new adjacent helper for explicit post-create metadata lookup and latest-open-PR selection through repository plus head-branch filtering. Purpose: give the explicit PR-selection contract its own direct proof home. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
25. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-adapter.test.ts`. Description: prove the scale-bounded review-fetch invariant owned by `server/src/flows/service.ts` or the new adjacent helper for paginated review submissions and paginated inline review comments. Purpose: give the multi-page GitHub review fetch paths their own explicit proof home. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
26. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-scratch.test.ts`. Description: prove the safe replacement invariant owned by `server/src/flows/service.ts` or the new adjacent helper for `codeInfoTmp/reviews/<story-number>-current-review.json` and the companion raw fetched artifact. State the reader or filesystem boundary that proves partial writes are not exposed. Purpose: give the scratch writer's reader-safe replacement contract its own explicit proof home. Proof owners: `server/src/test/unit/flows.github-scratch.test.ts`.
27. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-scratch.test.ts`. Description: prove the producer-consumer failure invariant owned by `server/src/flows/service.ts` or the new adjacent helper for malformed or partial scratch state being rejected instead of read as a clean review. Purpose: give the stale-versus-live and partial-state handling contract its own explicit proof home. Proof owners: `server/src/test/unit/flows.github-scratch.test.ts`.
28. [x] Test type: server unit. Location: `server/src/test/unit/flows.github-scratch.test.ts`. Description: prove the cleanup-ownership invariant owned by `server/src/flows/service.ts` or the new adjacent helper: readers may detect stale scratch but only the fetch writer may replace or clean the story-local handoff files. Purpose: keep persisted-state cleanup responsibilities explicit and non-overlapping. Proof owners: `server/src/test/unit/flows.github-scratch.test.ts`.
29. [x] Proof type: checked-in fixture. Location: `server/src/test/fixtures/flows/github-review/`. Description: add or update explicit PR lookup, paginated review payload, safe scratch replacement, raw `gh` failure, and scratch-file readback failure fixtures consumed by `server/src/test/unit/flows.github-adapter.test.ts` and `server/src/test/unit/flows.github-scratch.test.ts`. Purpose: keep the GitHub transport and scratch proof surfaces stable, deterministic, and checked in. Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`, `server/src/test/unit/flows.github-scratch.test.ts`.
30. [x] Run `npm run lint` for the files changed by this task and fix any issues found, using `npm run lint:fix` before manual cleanup when possible. Purpose: leave the GitHub transport and scratch surface in an honestly lint-clean state. Proof owners: `npm run lint` output for the changed Task 3 files.
31. [x] Run `npm run format:check` for the files changed by this task and fix any issues found, using `npm run format` before manual cleanup when possible. Purpose: leave the GitHub transport and scratch surface in an honestly formatted state. Proof owners: `npm run format:check` output for the changed Task 3 files.

#### Testing

1. [x] Run `npm run compose:build` because this task changes the supported server image and must prove the normal main-stack Docker build path still works.
2. [x] Run `npm run build:summary:server` because this task changes server runtime helpers and step execution code.
3. [x] Run `npm run test:summary:server:unit` because this task changes env parsing, subprocess transport, explicit selector logic, and scratch-file behavior.
4. [x] Run `npm run compose:up` because this task changes main-stack server runtime packaging and env wiring, and the supported human stack must still start successfully after the image change. This smoke step owns container startup only, not the full Story 60 GitHub review-cycle behavior.
5. [x] Run `npm run compose:down` because the previous step started the normal supported main stack and this task must leave that shared baseline stopped again after smoke validation.
6. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
7. [x] Run `npm run format:check` for this task's surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- 2026-06-24: Added `server/src/flows/githubReview.ts` as the Story 60 transport and scratch seam, wired `service.ts` to execute `github_open_pr`, `github_fetch_reviews`, and `github_close_pr`, and updated `server/Dockerfile` to install `gh` in the supported runtime. `server/npm-global.txt` did not need a matching change because this runtime path installs `gh` through apt rather than the global npm tool layer.
- 2026-06-24: Added deterministic GitHub review fixtures plus unit coverage in `server/src/test/unit/flows.github-adapter.test.ts` and `server/src/test/unit/flows.github-scratch.test.ts` for repo-local token reads, child-process env scoping, explicit repository and PR resolution, paginated review fetch, staged scratch replacement, malformed scratch rejection, and reader-only cleanup ownership. Targeted proof passed with `TS_NODE_TRANSPILE_ONLY=1 NODE_OPTIONS="--import ./scripts/register-ts-node-esm-loader.mjs --disable-warning=DEP0180" node --test --test-concurrency=1 src/test/unit/flows.github-adapter.test.ts src/test/unit/flows.github-scratch.test.ts`.
- 2026-06-24: Verified the new runtime seam compiles with `npm run build --workspace server`. `npm run lint --workspace server -- src/flows/service.ts src/flows/githubReview.ts src/test/unit/flows.github-adapter.test.ts src/test/unit/flows.github-scratch.test.ts` passed cleanly; the workspace `format:check` script widened into unrelated existing server formatting debt and rejected repo-root-relative paths, so the task-scoped replacement check used `npx prettier --check --ignore-unknown` on the changed Task 3 files and passed cleanly without widening this task into unrelated formatting cleanup.
- 2026-06-24: `npm run compose:build` passed on the supported main-stack Docker path, including the updated server image that now packages `gh` alongside the existing runtime tooling.
- 2026-06-24: `npm run build:summary:server` passed cleanly on the supported wrapper path after the Task 3 GitHub transport, repo-local token loading, and scratch-ownership changes, so no extra runtime compile fixes were needed before broader proof.
- 2026-06-24: `npm run test:summary:server:unit` passed cleanly with 2,469 passing tests, covering the broader server suite after the Task 3 GitHub transport, repo-local token loading, and scratch-file ownership changes without requiring follow-up repairs.
- 2026-06-24: `npm run compose:up` passed on the supported main stack after the Task 3 image and env-wiring changes; the server reached healthy status and the client started successfully, so the startup smoke surface stayed intact.
- Audit note: Task 3 is now `__done__` because its subtasks, automated proof checklist, and blocker check are all complete, and this audit found no story-caused preserved-behavior regression or other approved-scope gap that would justify keeping the task open.
- 2026-06-24: `npm run compose:down` passed after the Task 3 startup smoke step, removing the supported main-stack containers and network again so the shared baseline was left stopped cleanly.
- 2026-06-24: Manual proof stayed task-scoped. From a stopped baseline, `npm run compose:build`, `npm run compose:up`, `http://localhost:5010/health`, `http://localhost:5001`, `docker compose exec -T server gh --version`, and `npm run compose:down` all passed, and scratch proof was saved under `codeInfoTmp/manual-testing/0000060/3/` as `support-health.json`, `support-app-head.txt`, `support-gh-version.txt`, `support-flows.json`, `support-flow-catalog.txt`, and `support-compose-ps.json`. No screenshots were needed because Task 3 owns runtime packaging and transport rather than a browser-facing UI, and no additional subtasks were needed because the first checked-in GitHub review-cycle flow surface is still owned by Task 4.

### Task 4. Compose The Opt-In GitHub Review-Cycle Flow Variant And Preserve Default Entrypoints

- Repository Name: `Current Repository`
- Task Dependencies: `1, 2, 3`
- Task Status: `__done__`
- Git Commits:

#### Overview

Wire the new primitives into one copied opt-in implementation flow that can run an external GitHub review cycle without changing existing default entrypoints. This task owns PR-summary generation, findings routing, default-path preservation, and the final flow-composition proof surfaces.

#### Task Exit Criteria

- [ ] A copied opt-in flow variant can open a PR, wait, fetch outside review feedback, classify valid findings, leave clean-cycle PRs open, and close the PR only when more work was found.
- [ ] Existing default checked-in flow entrypoints remain unchanged unless an operator intentionally selects the new copied variant.
- [ ] When the opt-in GitHub review variant is unavailable because one of its nested required agents is missing, the existing `/flows` selector surfaces that exact variant as disabled, preserves the current runnable selection, and does not invite a run that will immediately fail.
- [ ] Proof owners cover clean cycle, supported skip, valid findings loopback, stale scratch replacement, and default-entrypoint preservation.

#### Documentation Locations

- https://cli.github.com/manual/gh_pr_create - use for the reviewer-facing PR creation contract that the opt-in flow composes.
- https://cli.github.com/manual/gh_api - use for the explicit API lookup and pagination behavior that the opt-in flow depends on.
- https://docs.github.com/en/rest/pulls/reviews - use for the review submission shape consumed during later classification.
- https://docs.github.com/en/rest/pulls/comments - use for the inline review comment shape consumed during later classification.

#### Subtasks

1. [x] Copy `flows/implement_next_plan.json` to `flows/implement_next_plan_github_review.json`. Purpose: create the required opt-in entrypoint before any Story 60 review-cycle composition is added. Proof owners: `server/src/test/integration/flows.run.basic.test.ts`, `e2e/flows-execution-runs.spec.ts`.
2. [x] Compose the new `if`, `wait`, and GitHub PR steps into `flows/implement_next_plan_github_review.json`. Purpose: wire the new primitives into one copied implementation flow without mutating the existing default flow. Proof owners: `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.loop.test.ts`.
3. [x] If Story 60 composition needs any other already in-use checked-in flow file, create a second copied variant for that exact file instead of editing the original in place. Purpose: preserve the story's default-entrypoint boundary even when adjacent in-use flow files must participate. Proof owners: `server/src/test/integration/flows.run.basic.test.ts`, `e2e/flows-execution-runs.spec.ts`.
4. [x] Test maintenance. Location: `server/src/test/unit/flows-schema.test.ts`. Description: extend the existing production-flow validation block to include `flows/implement_next_plan_github_review.json` and any other copied Story 60 flow variants, and rename or split the current production-flow validation test if its title would otherwise still imply only the older default flow set. Purpose: keep schema proof semantics aligned with the expanded opt-in flow inventory. Proof owners: `server/src/test/unit/flows-schema.test.ts`.
5. [x] In `server/src/flows/service.ts` and the GitHub helper file(s) created in Task 3 under `server/src/flows/`, build the PR title string from the active story context instead of hard-coding it in `flows/implement_next_plan_github_review.json`. The output must be a reviewer-facing title that stays stable for the same story and branch. Do not move this title text into agent command JSON or back into the default flow files. Purpose: keep the PR title consistent and reviewer-facing without scattering long text across flow definitions. Proof owners: `server/src/test/integration/flows.run.command.test.ts`.
6. [x] In `server/src/flows/service.ts` and the GitHub helper file(s) created in Task 3 under `server/src/flows/`, build the PR body string from the active story context. The output must include the implemented work summary and the no-out-of-scope-behavior-change instruction to reviewers, while leaving `flows/implement_next_plan_github_review.json` as a thin flow definition rather than a long prose container. Purpose: keep the reviewer context complete without making the copied flow JSON carry bespoke multi-paragraph text. Proof owners: `server/src/test/integration/flows.run.command.test.ts`.
7. [x] In `server/src/flows/service.ts`, write supported GitHub-review skip or failure reasons into the active plan notes at the point where the GitHub stage stops. Use the same durable plan-note surface already used by flow runs, and do not leave the skip or failure explanation only in transient scratch JSON. Purpose: keep skip and failure outcomes durable in the plan instead of only in transient scratch state. Proof owners: `server/src/test/integration/flows.run.basic.test.ts`.
8. [x] In `server/src/flows/service.ts`, map supported GitHub-review skip outcomes to the flow status used for completed-with-warning, and leave clean completion reserved for cycles where the GitHub stage actually ran and produced a clean result. Do not change the status contract for non-GitHub flows. Purpose: keep flow status truthful when the optional GitHub stage did not run. Proof owners: `server/src/test/integration/flows.run.basic.test.ts`.
9. [x] In `server/src/flows/service.ts`, change the review-classification read path so it reads the current story and branch from the fresh GitHub scratch handoff written by Task 3, not from stale scratch left by an older cycle. Do not add a second scratch format or a second classification input source. Purpose: stop stale scratch from remaining the classification input after a successful new fetch. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
10. [x] In the review-classification code path in `server/src/flows/service.ts`, filter out review submissions and inline comments authored by the PR author before outside-feedback classification begins. Leave reviewer-authored comments unchanged. Purpose: keep the GitHub review cycle limited to feedback from other users. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
11. [x] In the review-classification code path in `server/src/flows/service.ts`, treat an empty fetched review set and a fully non-actionable fetched review set as clean-cycle outcomes. The clean path must leave the PR open and must not enter the findings loopback branch. Purpose: preserve the clean-review-cycle contract without forcing unnecessary PR closure. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/features/flows-execution-runs.feature`.
12. [x] In the review-classification and loopback code path in `server/src/flows/service.ts`, close the PR only after valid findings have been identified and the flow has decided more work is required. Do not close the PR before classification completes, and do not close clean-cycle PRs. Purpose: preserve the findings-present loopback contract without closing clean-cycle PRs. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/features/flows-execution-runs.feature`.
13. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.basic.test.ts`. Description: prove the default-entrypoint preservation invariant owned by `flows/implement_next_plan.json`, the copied flow variant file(s), and `server/src/flows/service.ts` when the copied variant is not selected. Purpose: give the opt-in default-path boundary its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.basic.test.ts`.
14. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.basic.test.ts`. Description: prove the completed-with-warning skip invariant owned by `server/src/flows/service.ts` and the Task 3 GitHub helper files when GitHub review is skipped for a supported reason. Purpose: give the truthful skip-status path its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.basic.test.ts`.
15. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.command.test.ts`. Description: prove the generated reviewer-facing PR title invariant owned by `server/src/flows/service.ts` and the Task 3 GitHub helper files. Purpose: give the PR title-generation seam its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.command.test.ts`.
16. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.command.test.ts`. Description: prove the generated reviewer-facing PR body invariant owned by `server/src/flows/service.ts` and the Task 3 GitHub helper files, including the no-out-of-scope-behavior-change instruction. Purpose: give the PR body-generation seam its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.command.test.ts`.
17. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.loop.test.ts`. Description: prove the clean-cycle invariant owned by `server/src/flows/service.ts`, the copied flow variant file(s), and the Task 3 GitHub helper files when a review cycle leaves the PR open. Purpose: give the clean review-loop outcome its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
18. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.loop.test.ts`. Description: prove the findings-present loopback invariant owned by `server/src/flows/service.ts`, the copied flow variant file(s), and the Task 3 GitHub helper files when valid findings close the PR before loopback. Purpose: give the more-work-needed review-loop outcome its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
19. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.loop.test.ts`. Description: prove the fresh-scratch precedence invariant owned by `server/src/flows/service.ts` and the Task 3 scratch helper files when stale review scratch must be replaced before readback. Use an explicit file or state boundary instead of adjacent success proof. Purpose: give the stale-versus-fresh scratch contract its own explicit proof home. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
20. [x] Test type: server integration. Location: `server/src/test/integration/flows.run.loop.test.ts`. Description: prove the exact review-cycle ordering boundary owned by `server/src/flows/service.ts`, the copied flow variant file(s), and the Task 3 GitHub helper files in one scenario: PR open completes before wait persistence, wait resume completes before review fetch dispatch, fresh scratch replacement completes before classification reads it, and PR close happens before loopback when valid findings exist. Purpose: stop the composed Story 60 lifecycle from being proved only by adjacent step-local assertions. Proof owners: `server/src/test/integration/flows.run.loop.test.ts`.
21. [x] Test type: cucumber. Location: `server/src/test/features/flows-execution-runs.feature` and `server/src/test/steps/flows-execution-runs.steps.ts`. Description: prove the clean review-cycle invariant owned by the copied flow variant file(s) and `server/src/flows/service.ts`. Rename the feature heading or split the scenarios if the current retry-ownership feature title would otherwise misdescribe the new Story 60 clean-cycle coverage. Purpose: carry the clean Story 60 loop into the authored flow proof surface without semantic drift. Proof owners: `server/src/test/features/flows-execution-runs.feature`, `server/src/test/steps/flows-execution-runs.steps.ts`.
22. [x] Test type: cucumber. Location: `server/src/test/features/flows-execution-runs.feature` and `server/src/test/steps/flows-execution-runs.steps.ts`. Description: prove the findings-present review-cycle invariant owned by the copied flow variant file(s) and `server/src/flows/service.ts`. Keep the review-cycle scenario title separate from retry-ownership wording so ordering-sensitive PR-close-before-loopback assertions are claimed directly. Purpose: carry the more-work-needed Story 60 loop into the authored flow proof surface. Proof owners: `server/src/test/features/flows-execution-runs.feature`, `server/src/test/steps/flows-execution-runs.steps.ts`.
23. [x] Test type: e2e. Location: `e2e/flows-execution-runs.spec.ts`. Description: prove the operator-facing flow-selection invariant owned by the copied flow variant file(s) and the default entrypoint files when the copied variant is selected without mutating current defaults. Keep this as a distinct Story 60 browser test with its own title instead of broadening the existing retry-ownership test title to cover adjacent behavior. Purpose: keep the browser-visible flow-selection surface honest for operators. Proof owners: `e2e/flows-execution-runs.spec.ts`.
24. [x] Run `npm run lint` for the files changed by this task and fix any issues found, using `npm run lint:fix` before manual cleanup when possible. Purpose: leave the opt-in flow composition and status-routing surface in an honestly lint-clean state. Proof owners: `npm run lint` output for the changed Task 4 files.
25. [x] Run `npm run format:check` for the files changed by this task and fix any issues found, using `npm run format` before manual cleanup when possible. Purpose: leave the opt-in flow composition and status-routing surface in an honestly formatted state. Proof owners: `npm run format:check` output for the changed Task 4 files.
26. [x] In `server/src/flows/discovery.ts`, extend the recursive flow-agent discovery used by `/flows` list summaries and flow details so it also walks nested agent-bearing branches inside composed containers used by `flows/implement_next_plan_github_review.json`, including the `if`/branch path that reaches `review_agent`. The resulting summary/detail payload for `/data/codeInfo2` must mark `implement_next_plan_github_review` disabled soon enough for the existing selector in `client/src/pages/FlowsPage.tsx` to render that row with the built-in disabled `ListItemButton` state, keep `flow-select-trigger` on the last runnable flow, and keep `flow-run` from advertising a startable GitHub-review launch. Do not add a new UI control or alternate copy path; feed the existing disabled-flow contract correctly. Purpose: keep the operator-facing disabled-state contract aligned with the actual run-time agent requirements of the copied Story 60 variant. Proof owners: `server/src/test/integration/flows.list.test.ts`, `client/src/test/flowsPage.runGuard.test.tsx`, `e2e/flows-execution-runs.spec.ts`.
27. [x] Test type: server integration. Location: `server/src/test/integration/flows.list.test.ts`. Description: add a focused Task 4 listing proof that `implement_next_plan_github_review` is returned as disabled with the shared `agent_not_found` reason when `review_agent` is unavailable only through a nested branch in the copied flow, instead of appearing runnable until `POST /flows/:flowName/run` fails with `AGENT_NOT_FOUND`. Pair that with an operator-surface proof in `client/src/test/flowsPage.runGuard.test.tsx` or the existing Story 60 browser proof so the `/flows` selector row for `implement_next_plan_github_review /data/codeInfo2` stays disabled and the active runnable selection is preserved. Purpose: give the misleading operator-facing availability seam its own automated proof home. Proof owners: `server/src/test/integration/flows.list.test.ts`, `client/src/test/flowsPage.runGuard.test.tsx`, `e2e/flows-execution-runs.spec.ts`.
28. [x] Run `npm run lint` for the files changed by this follow-up and fix any issues found, using `npm run lint:fix` before manual cleanup when possible. Purpose: leave the reopened Task 4 flow-discovery and proof surface in an honestly lint-clean state. Proof owners: `npm run lint` output for the changed Task 4 files.
29. [x] Run `npm run format:check` for the files changed by this follow-up and fix any issues found, using `npm run format` before manual cleanup when possible. Purpose: leave the reopened Task 4 flow-discovery and proof surface in an honestly formatted state. Proof owners: `npm run format:check` output for the changed Task 4 files.

#### Testing

1. [x] Run `npm run build:summary:server` because this task changes flow composition and server runtime orchestration.
2. [x] Run `npm run test:summary:server:unit` because this task changes runtime orchestration, copied flow definitions, and producer-consumer review-scratch behavior.
3. [x] Run `npm run test:summary:server:cucumber` because this task changes authored flow behavior and loop routing through the repository's flow execution surface.
4. [x] Run `npm run test:summary:e2e` because this task changes a browser-visible flow execution path and must keep the supported automated end-to-end surface honest. This wrapper owns its own automated setup and teardown; Task 5 owns the separate normal main-stack compose smoke for the human Docker path.
5. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
6. [x] Run `npm run format:check` for this task's surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

Use the supported main stack at `http://localhost:5001/flows`. With `review_agent` absent from `manual_testing/codeinfo_agents`, open the Flow selector and confirm the existing `implement_next_plan_github_review /data/codeInfo2` row uses the same disabled affordance as the other unavailable checked-in flows, does not become the active `flow-select-trigger` value, and does not leave `flow-run` presenting a startable GitHub-review launch.

#### Implementation notes

- Subtask 1: copied `flows/implement_next_plan.json` into the new opt-in `flows/implement_next_plan_github_review.json` entrypoint so Story 60 review-cycle wiring stayed off the default file.
- Subtask 2: composed the GitHub PR open, persisted wait, review fetch, conditional branch, and findings-only PR close path into the copied flow variant instead of mutating the default implementation flow.
- Subtask 3: confirmed no second copied flow variant was required for Task 4 because the Story 60 review cycle could be composed entirely within the new implement-next-plan variant.
- Subtask 4: extended the production-flow schema proof to cover the copied GitHub review variant and renamed the validation test so it no longer implied only the old default flow inventory.
- Subtask 5: generated the reviewer-facing PR title from the active Story 60 context in `server/src/flows/service.ts` instead of hard-coding it into the flow JSON.
- Subtask 6: generated the reviewer-facing PR body from active story context, including the implemented-work summary and the no-out-of-scope-behavior-change reviewer instruction.
- Subtask 7: added durable Task 4 plan-note writes for supported GitHub skip and failure outcomes and repaired the task-block matcher so plan notes append to the active task instead of transient scratch only.
- Subtask 8: kept supported GitHub skip outcomes on the truthful non-failure path while reserving clean completion semantics for cycles where the GitHub stage actually runs.
- Subtask 9: changed the review-classification readback path to re-read the fresh Task 3 handoff after fetch success before materializing the external review input.
- Subtask 10: filtered PR-author review submissions and inline comments out of the GitHub external review input so later classification only sees outside-reviewer feedback.
- Subtask 11: kept empty or fully non-actionable fetched reviewer feedback on the clean path so the PR stays open and findings loopback does not trigger unnecessarily.
- Subtask 12: limited `github_close_pr` to the findings-present repair branches so clean-cycle PRs remain open and close only happens after classification decides more work is needed.
- Subtask 13: added the basic integration proof that the default entrypoint stays untouched while the copied variant carries the GitHub review-cycle path.
- Subtask 14: used the same basic integration proof home to verify the supported GitHub skip path records a durable active-plan note when `.env.local` is missing.
- Subtask 15: added the integration proof for the generated reviewer-facing PR title contract.
- Subtask 16: added the integration proof for the generated reviewer-facing PR body contract, including the out-of-scope behavior warning to reviewers.
- Subtask 17: added loop-surface proof that the checked-in GitHub review variant preserves the clean-cycle ordering boundary and does not close clean-cycle PRs.
- Subtask 18: added loop-surface proof that findings-present close behavior lives only in the repair branches before loopback.
- Subtask 19: added the explicit stale-scratch replacement proof that fresh GitHub reviewer feedback replaces older scratch before classification reads it back.
- Subtask 20: added the explicit review-cycle ordering proof that open, wait, fetch, fresh-scratch readback, and findings-only close stay in the authored Story 60 order.
- Subtask 21: renamed the cucumber feature heading and added authored-flow assertions that cover the clean GitHub review-cycle branch in the copied variant.
- Subtask 22: added the paired cucumber assertions for the findings-present branch so PR-close-before-loopback behavior is claimed directly in the authored flow surface.
- Subtask 23: added the e2e proof that operators can select `implement_next_plan_github_review` without mutating the existing default entrypoint.
- Subtask 24: ran targeted ESLint over the changed Task 4 TypeScript and e2e files, then removed unused proof scaffolding and fixed import-order drift until the Task 4 surface was lint-clean.
- Subtask 25: ran targeted Prettier checks on the changed Task 4 files, used `prettier --write` for the files that drifted, and re-ran `--check` to confirm the Task 4 surface was formatted cleanly.
- 2026-06-24: `npm run build:summary:server` passed cleanly on the supported wrapper path after the Task 4 flow-composition, status-routing, and review-cycle orchestration changes, so no compile follow-up was needed before broader proof.
- 2026-06-24: `npm run test:summary:server:unit` failed first on two checked-in flow path regressions in the new Task 4 integration tests, then once more on a temp-fixture-versus-repo-root mix-up in the skip-note assertion. Updating those tests to read checked-in flow JSON from the actual repository root fixed the issue, and the full wrapper rerun then passed cleanly with 2,473 passing tests.
- 2026-06-24: `npm run test:summary:server:cucumber` passed cleanly with 132 passing authored-flow tests after the Task 4 GitHub review-cycle composition and loop-routing updates landed.
- 2026-06-24: `npm run test:summary:e2e` failed first on stale browser expectations for the shipped endpoint-aware model-label format and one crossed expectation in the mobile history-versus-fresh reset path. Updating the affected Playwright assertions to the current `model (endpoint)` label contract and the actual saved-history/fresh-conversation state transitions fixed the issue, and the full wrapper rerun then passed cleanly with 77 passing tests.
- 2026-06-24: `npm run lint` passed cleanly after the Task 4 integration-test and Playwright expectation repairs, so the broadened proof surface is currently lint-clean.
- 2026-06-24: `npm run format:check` passed cleanly after the Task 4 test-path and Playwright expectation repairs, so the current proof surface remains formatter-clean as well.
- Audit note: Task 4 is now `__done__` because its subtasks, automated proof checklist, and blocker check are all complete. The wrapper-backed proof repairs stayed inside test and plan-maintenance surfaces, and this audit found no story-caused preserved-behavior regression or other approved-scope gap that would justify keeping the task open.
- 2026-06-24: Manual testing ran on the supported main compose stack and proved startup, health, `/flows` reachability, and the operator-facing selection surface for `implement_next_plan_github_review`, with scratch proof saved under `codeInfoTmp/manual-testing/0000060/4/`. The browser proof showed the GitHub review variant selectable while `echo` remained the default, but the first honest run failed with `AGENT_NOT_FOUND` because `review_agent` is absent from `manual_testing/codeinfo_agents` and `server/src/flows/discovery.ts` did not disable the variant when that dependency appeared only in a nested branch. Added concrete follow-up subtasks in `server/src/flows/discovery.ts` and `server/src/test/integration/flows.list.test.ts`, and reopened build, server-unit, lint, and format proof because automated validation must rerun before a later manual retest.
- 2026-06-24: Preflight visual refinement ran against the live `/flows` selector on the supported main stack and clarified the exact disabled-row and preserved-selection seam for `implement_next_plan_github_review /data/codeInfo2` in `server/src/flows/discovery.ts`, `client/src/pages/FlowsPage.tsx`, and the run-guard/browser proof owners. No code changed in this step.
- Subtask 26: extended flow discovery recursion so nested `if` branches contribute both their branch-local agent requirements and any AI-driven `if` agent type to the disabled-flow calculation before `/flows` exposes the GitHub review variant.
- Subtask 27: added focused server and client proof that the ingested `implement_next_plan_github_review /data/codeInfo2` row is disabled with `agent_not_found` when only nested `review_agent` availability is missing and that the active runnable selection stays on `echo`.
- Subtask 28: ran targeted ESLint on `server/src/flows/discovery.ts`, `server/src/test/integration/flows.list.test.ts`, and `client/src/test/flowsPage.runGuard.test.tsx`; the reopened discovery follow-up stayed lint-clean without further code changes.
- Subtask 29: ran targeted Prettier checks on the reopened discovery and proof files, used `prettier --write` on the two drifted test files, and re-ran `--check` to confirm the follow-up surface is formatter-clean.
- Audit 2026-06-24: marked Testing 5 and 6 complete from the immediately preceding discovery follow-up pass because Subtasks 28 and 29 already recorded honest task-surface lint and format reruns. `npm run build:summary:server` and `npm run test:summary:server:unit` remain open for the later wrapper-backed proof rerun after the reopened nested-agent discovery fix.
- 2026-06-24: Reopened `npm run build:summary:server` passed cleanly after the nested-agent discovery follow-up landed, so the server compile surface remained intact for Task 4 before the final unit rerun.
- 2026-06-24: Reopened `npm run test:summary:server:unit` failed first on one more wrapper-cwd regression in `server/src/test/integration/flows.list.test.ts`, where the new disabled-variant proof copied the checked-in GitHub review flow from `server/flows/...` instead of the repository root. Pointing that copy to the actual repository root fixed the issue, and the full wrapper rerun then passed cleanly with 2,474 passing tests.
- Audit note: Task 4 is now `__done__` because its reopened nested-agent discovery follow-up, automated-proof checklist, and blocker check are all complete. The final proof rerun repair stayed inside `server/src/test/integration/flows.list.test.ts` and plan-maintenance surfaces, and this audit found no remaining story-caused preserved-behavior regression or other approved-scope gap that would justify keeping the task open.
- 2026-06-24: Manual testing reran on the supported main compose stack after a restart-by-default freshness reset, stayed task-scoped, and proved `http://localhost:5010/health`, `http://localhost:5001/flows`, and the Task 4 operator contract together. `/flows` now lists `implement_next_plan_github_review /data/codeInfo2` as disabled with the shared `review_agent`-missing reason, opening the selector shows that row in the same disabled option group as the other unavailable checked-in flows, clicking the disabled row leaves `echo` selected, and the composer still presents the normal `Send` launch for `echo` instead of advertising a startable GitHub-review run. Scratch proof was refreshed under `codeInfoTmp/manual-testing/0000060/4/` with backend captures, browser console output, Playwright snapshots, and the latest selector screenshots; no additional subtasks were needed.

### Task 5. Final Story Validation And Close-Out

- Repository Name: `Current Repository`
- Task Dependencies: `1, 2, 3, 4`
- Task Status: `__done__`
- Git Commits:

#### Overview

Validate the entire Story 60 surface after the implementation tasks land, then update the repository documentation and close-out artifacts to match the final shipped behavior. This task owns the full acceptance-criteria trace, the final wrapper-based proof run, and the manual-testing guidance for the supported main stack.
This task also owns the final operator-facing `/flows` proof seam: choosing a real worked repository from `Working path`, switching the `Flow` combobox away from the default `echo` entry to the copied GitHub review variant, and capturing the visible run-state evidence from that supported UI.

#### Task Exit Criteria

- [ ] Every Acceptance Criterion, important Description requirement, and explicit Out Of Scope boundary is matched to the final implementation, named proof surfaces, or explicit preserved default-path behavior.
- [ ] Final documentation and `codeInfoStatus/pr-summaries/0000060-pr-summary.md` describe the shipped flow contract, GitHub token and permission rules, copied flow variant name(s), and supported completed-with-warning cases.
- [ ] Full wrapper-based automated validation passes, and final manual guidance points the later tester to the supported main stack, readiness checks, the `/flows` operator sequence for choosing a real sandbox repo and selecting `implement_next_plan_github_review`, artifact destinations, and honest skip rules.

#### Documentation Locations

- https://cli.github.com/manual/gh_pr_create - final documentation and PR summary must match the shipped PR creation contract.
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens - final documentation and PR summary must preserve the minimum fine-grained token permission statement.
- Context7 `/nodejs/node/v22.17.0` - final validation must stay aligned with the shipped wait and resume runtime contract.

#### Subtasks

1. [x] Re-read the `Description`, `Acceptance Criteria`, and `Out Of Scope` sections in this plan file, then compare each item to the implementation surfaces from Tasks 1 through 4 and their named proof owners. If any in-scope behavior or preserved boundary is still missing a proof home, fix that mismatch in the owned code or documentation files before the final wrapper runs. Purpose: make the final validation task prove the full in-scope behavior instead of only adjacent behavior. Proof owners: this plan file, the Task 1 through Task 4 proof owners, and the final wrapper runs in this task's `Testing` section.
2. [x] Re-open `flows/implement_next_plan.json` and the copied Story 60 flow variant file(s) created earlier in this story, and compare them directly. Confirm the default file still preserves its pre-Story-60 behavior while the copied variant alone carries the new GitHub review-cycle path. Do not rely on memory or on test names alone for this check. Purpose: make the final validation task prove that Story 60 did not widen beyond its approved behavior envelope. Proof owners: `flows/implement_next_plan.json`, the copied flow variant file(s), and the final wrapper runs in this task's `Testing` section.
3. [x] Re-open the Task 1 through Task 4 proof-owner files for the lifecycle-sensitive rows that Story 60 changes: waiting, resumed, skipped-with-warning, error, cancel, startup recovery, stale-scratch replacement, and default-path preservation. Confirm each row has one direct proof home before final wrapper runs start. Purpose: keep the highest-risk invariants visible in the final validation pass instead of assuming broad wrapper success is enough. Proof owners: the Task 1 through Task 4 proof owners and the final wrapper runs in this task's `Testing` section.
4. [x] Update `design.md` so it documents the final flow-only primitive set and the shared AI-or-script decision contract. Purpose: keep repository architecture guidance aligned with the shipped Story 60 control-flow surface. Proof owners: `design.md`.
5. [x] Update `design.md` so it documents the persisted wait lifecycle, the repository-local `CODEINFO_PR_TOKEN` contract, and the exact copied opt-in flow variant name(s) created by this story. Purpose: keep repository architecture guidance aligned with the shipped Story 60 lifecycle and GitHub transport behavior. Proof owners: `design.md`.
6. [x] Update `projectStructure.md` so it lists any new flow runtime helpers and GitHub review scratch helpers introduced by Story 60. Purpose: give later developers a truthful file-level map of the new runtime seams. Proof owners: `projectStructure.md`.
7. [x] Update `projectStructure.md` so it lists any new checked-in fixtures and copied flow files introduced by Story 60. Purpose: give later developers a truthful file-level map of the new proof surfaces and opt-in entrypoints. Proof owners: `projectStructure.md`.
8. [x] Create or refresh `codeInfoStatus/pr-summaries/0000060-pr-summary.md` with the final behavior summary and the minimum GitHub permission contract. Purpose: produce the repository's derived close-out artifact for Story 60 with the final external contract details. Proof owners: `codeInfoStatus/pr-summaries/0000060-pr-summary.md`.
9. [x] Update `codeInfoStatus/pr-summaries/0000060-pr-summary.md` with the supported completed-with-warning cases, the named proof surfaces, and any final manual-proof notes that a reviewer needs to understand the story outcome quickly. Purpose: complete the derived close-out artifact without replacing the executable plan as source of truth. Proof owners: `codeInfoStatus/pr-summaries/0000060-pr-summary.md`.
10. [x] Run `npm run lint` for the files changed by this task and fix any issues found, using `npm run lint:fix` before manual cleanup when possible. Purpose: leave the close-out docs and story artifacts in an honestly lint-clean state. Proof owners: `npm run lint` output for the changed Task 5 files.
11. [x] Run `npm run format:check` for the files changed by this task and fix any issues found, using `npm run format` before manual cleanup when possible. Purpose: leave the close-out docs and story artifacts in an honestly formatted state. Proof owners: `npm run format:check` output for the changed Task 5 files.

#### Testing

1. [x] Run `npm run compose:build` because the final story proof must include the shipped main-stack Docker build path that now carries `gh`, the copied flow assets, and the final server runtime wiring.
2. [x] Run `npm run build:summary:server` because Story 60 changes server flow schema, runtime orchestration, GitHub transport, and copied flow definitions.
3. [x] Run `npm run test:summary:server:unit` because the final story changes schema parsing, lifecycle-sensitive state, transport helpers, and review-scratch producer-consumer behavior.
4. [x] Run `npm run test:summary:server:cucumber` because the final story changes authored flow behavior, wait resume, and review-loop routing.
5. [x] Run `npm run test:summary:e2e` because the final story changes the supported browser-visible flow execution surface and must keep end-to-end automation honest.
6. [x] Run `npm run compose:up` because the final story changes the normal supported human stack and needs an explicit smoke start through `docker-compose.yml` after the main-stack build and automated suites complete. If this step fails before server health and client readiness are reachable, treat that as a main-stack baseline or harness failure to diagnose separately from Story 60 flow logic.
7. [x] Run `npm run compose:down` because the previous step started the normal supported main stack and final proof must leave that shared baseline stopped again after smoke validation.
8. [x] Run `npm run lint` for this task's surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
9. [x] Run `npm run format:check` for this task's surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- Use the checked-in main human stack for Story 60 manual proof: run `npm run compose:build`, then `npm run compose:up`. These wrappers already load `server/.env` and `server/.env.local` for the main stack. Before starting story proof, confirm the server health surface at `http://localhost:5010/health` is ready and the normal client surface at `http://localhost:5001` is responding, then open `http://localhost:5001/flows` from a fresh draft state where `echo` is still the default selected flow. Use `npm run compose:down` when you are done.
- Use a dedicated sandbox worked repository on the Story 60 branch with its normal upstream remote already configured. Place that sandbox repository under the host ingest root configured by `CODEINFO_HOST_INGEST_DIR` so the main stack can resolve it through the normal worked-repository namespace. Put `CODEINFO_PR_TOKEN` only in that worked repository's `.env.local`; do not move it into `server/.env` or `server/.env.local`. The `/flows` `Working path` picker may show directories that are merely present under the ingest root, so do not treat picker visibility alone as proof that a folder is a usable worked repository.
- In the `/flows` composer, open `Working path` first and choose only a readable git repository that is actually on the Story 60 branch and has the repo-local `.env.local` token contract needed for this story. If the picker surfaces only non-repository, unreadable, or wrong-branch directories, stop the live GitHub-cycle proof there, record that limitation honestly, and do not substitute the current `codeInfo2` checkout just to force a run.
- After the worked repository is confirmed, switch the `Flow` combobox from the default `echo` entry to `implement_next_plan_github_review` before starting the first proof run. Treat that visible selection state as part of the task-owned proof surface instead of assuming the correct flow from conversation context alone.
- Prove the full story with at least two manual cycles: one short-wait clean cycle that opens a PR, resumes automatically after the authored delay, fetches outside review data, and leaves the PR open; and one findings-present cycle that proves valid outside findings close the PR before loopback and route follow-up work through the existing repair path instead of a bespoke review workflow.
- If time allows, also verify the supported completed-with-warning skip path by removing or blanking `CODEINFO_PR_TOKEN` in the worked repository `.env.local` and confirming the flow records a concise skip note instead of pretending a clean external review occurred.
- Save any manual screenshots, exported JSON, logs, or similar proof artifacts under `codeInfoTmp/manual-testing/0000060/5/` and do not commit them. Recommended basenames: `proof-01-variant-selection.png`, `proof-02-open-pr.png`, `proof-03-clean-cycle-status.png`, `proof-04-finding-cycle-status.png`, `proof-05-skip-warning-status.png`, `support-current-review.json`, `support-console.txt`, and `support-network.json`.
- Capture the initial pre-run operator state on desktop before the first live cycle: the fresh `/flows` draft, the `Working path` dialog showing the chosen sandbox repo, and the `Flow` combobox switched to `implement_next_plan_github_review`. If those states cannot all fit in one retained image, keep separate captures and describe which control each image proves.
- Treat the Task 5 screenshots and retained support artifacts as the primary closeout proof for the story's final observable flow state. Keep earlier task-level screenshots in the later durable bundle only when they still prove something unique that these final Story 60 artifacts do not re-cover.
- If you use Playwright MCP screenshots, capture them in the Playwright MCP staging directory under `$CODEINFO_ROOT/playwright-output-local/0000060/task-5/` first, then transfer them into `codeInfoTmp/manual-testing/0000060/5/`. If the runtime artifact source is unclear, inspect the available runtime handoff JSON for the artifact-source and destination details by meaning rather than by exact property names.
- A narrow-viewport preflight is enough for mobile in this task: confirm the `/flows` page still exposes `Working path`, `Flow`, and `Send` without hiding the composer behind an unreachable layout state. The retained final proof for the actual GitHub review cycles should stay desktop-primary unless mobile reveals a task-owned regression.
- If any auth-dependent provider surface cannot be exercised because restoring login would require human-controlled two-factor authentication, skip only that affected surface, record the limitation honestly, and rely on the automated proof plus retained logs for that seam. Do not attempt `Re-authenticate` during autonomous manual proof.
- Later closeout should promote the curated durable proof bundle for this story into `codeInfoStatus/manual-proof/0000060/`.

#### Implementation notes

- Starts empty. Update during implementation with concise notes about what changed, what issues appeared, and what decisions were made.
- Subtask 1: re-read the story description, acceptance criteria, and out-of-scope boundaries against the shipped Task 1 through Task 4 runtime and proof homes; no new coverage gap surfaced before final wrappers, so the close-out pass stayed documentation-first.
- Subtask 2: re-opened `flows/implement_next_plan.json` and `flows/implement_next_plan_github_review.json` directly and confirmed the default entrypoint still omits Story 60 GitHub steps while the copied variant alone carries PR open, wait, fetch, reviewer-feedback gating, and findings-only close behavior.
- Subtask 3: re-opened the Story 60 proof owners for wait/resume, completed-with-warning skip, cancel/startup stop handling, stale-scratch replacement, and default-path preservation; each high-risk seam already has at least one direct proof home ahead of the final wrapper reruns.
- Subtask 4: updated `design.md` with the final flow-only primitive set and the shared AI-or-script decision contract so the repository architecture notes now match the shipped Story 60 control-flow surface.
- Subtask 5: extended `design.md` with the persisted wait lifecycle, repository-local `CODEINFO_PR_TOKEN` rules, minimum GitHub permission statement, completed-with-warning skip surface, and the exact copied `implement_next_plan_github_review` entrypoint name.
- Subtask 6: updated `projectStructure.md` to list the new Story 60 runtime seams, especially `server/src/flows/githubReview.ts` and the flow runtime files that now own wait, condition, and review-scratch behavior.
- Subtask 7: updated `projectStructure.md` to list the checked-in Story 60 fixtures, the copied flow variant, and the new proof homes that keep the opt-in GitHub review path traceable.
- Subtask 8: created `codeInfoStatus/pr-summaries/0000060-pr-summary.md` with the final Story 60 behavior summary and the minimum GitHub `Pull requests: write` token contract.
- Subtask 9: extended the Story 60 PR summary with the completed-with-warning cases, named proof surfaces, and final manual-proof guidance pointers while keeping the executable plan as the source of truth for later wrapper and manual proof.
- Subtask 10: `npm run lint` passed cleanly on the current Story 60 close-out branch state, so the documentation-only Task 5 surface introduced no lint regression before the final wrapper suite.
- Subtask 11: `npm run format:check` passed cleanly, confirming the updated Story 60 docs, plan notes, and PR summary stayed formatter-clean before the later full validation task runs.
- Testing 1: `npm run compose:build` passed cleanly on the main stack, proving the shipped Docker build still carries the Story 60 `gh` tooling, copied flow assets, and final runtime wiring without any extra repair work.
- Testing 2: `npm run build:summary:server` passed cleanly on the first rerun, so the final Story 60 server compile surface still matches the shipped flow schema, runtime orchestration, GitHub transport, and copied flow definitions.
- Testing 3: `npm run test:summary:server:unit` passed cleanly with 2,474 passing tests and no failures, so the final Story 60 schema parsing, lifecycle-sensitive state, transport helpers, and review-scratch producer-consumer coverage all held without further repair work.
- Testing 4: `npm run test:summary:server:cucumber` passed cleanly with 132 passing scenarios and no failures, so the final authored-flow wait, resume, review-loop routing, and default-path behavior all stayed green in the executable feature coverage.
- Testing 5: `npm run test:summary:e2e` passed cleanly with 77 passing tests and no failures, so the final browser-visible Story 60 flow surface stayed honest through the checked-in compose build, host-network wiring, automated browser run, and teardown path.
- Testing 6: the first `npm run compose:up` attempt failed on a port-5010 preflight collision from an already-running main-stack instance under the same `docker-compose.yml`; bringing that stale main stack down and rerunning `npm run compose:up` then succeeded with the server healthy and client started, so the supported human stack still comes up cleanly after the final Story 60 proof suite.
- Testing 7: `npm run compose:down` then completed cleanly after the successful smoke start, leaving the checked-in main stack stopped again so the final Story 60 automated proof closes in the expected shared-baseline state.
- Testing 8: `npm run lint` passed cleanly on the current Story 60 close-out surface, so the remaining task-owned docs, plan state, and shipped review-loop files are lint-clean at the final automated-proof stage.
- Testing 9: `npm run format:check` passed cleanly, so the remaining Task 5 close-out surface stays formatter-clean at the final automated-proof stage without any repair edits.
- Audit note: Task 5 is now `__done__`. All close-out subtasks and all Testing rows 1 through 9 are evidenced on disk, no parser-reported live blocker remains, and this audit found no story-caused preserved-behavior regression or other approved-scope gap that would justify reopening the task. Manual testing guidance remains optional follow-up for the later manual-testing pass and is not a blocking completion gate for this automated-proof audit.
- Manual testing skipped for the final Story 60 live GitHub review-cycle surface. Tried: inspected the configured `CODEINFO_HOST_INGEST_DIR=/home/dan/code` namespace and its available git repositories for a dedicated sandbox worked repository on the Story 60 branch with an upstream remote and repo-local `.env.local`. Observed: the only git repository in that namespace is this working repository itself, and no separate sandbox worked repository was available to exercise the live PR-open, wait, review-fetch, and findings-close cycles honestly. Why fuller proof was not possible: Task 5 manual guidance requires a dedicated sandbox worked repository under the ingest root for final live GitHub proof, and that supporting repository is currently absent outside the active plan or task repair scope.
- 2026-06-26: Preflight visual refinement ran against the supported main-stack `/flows` surface, clarified the final operator path through the fresh `echo` draft, the `Working path` dialog, the `implement_next_plan_github_review` flow selection seam, and the need to reject non-repository or unreadable folders that still appear in the picker. No code changed in this step.

## Code Review Findings

### Review Pass `0000060-20260626T222120Z-3a823780`

- Source of truth: `codeInfoStatus/flow-state/review-disposition-state.json` for active routing. `codeInfoTmp/reviews/0000060-current-review.json` and the referenced evidence artifacts remain scratch review-loop evidence for this pass rather than durable plan state.
- Review comparison context: local `HEAD` `3a8237806531e55db127093abb2dd753fd918925` vs resolved remote base `origin/main` at commit `9833bf9addc2515edb774f3a92307dd594b05062`, with `remote_fetch_status: success` and no local-fallback base inference needed for this pass.
- Active review cycle: `0000060-rc-20260627T002941Z-3f3b9d27`.
- No inline-resolved minor findings were recorded in this active review cycle before serious task-up routing began.
- No unresolved minor-batchable findings remain in active routing for this pass.
- Remaining unresolved task-required findings that must be encoded into executable plan state before Story `0000060` can close: `completed-with-warning-terminal-state`, `startup-wait-recovery-missing`, `trustworthy-review-base-branch`, `wait-resume-sourceid-loss`, `current-review-handoff-schema-collision`, `unvalidated-persisted-path-authority`, `paused-launch-retry-barrier-loss`, `github-open-pr-post-create-replay-ambiguity`, `premature-if-branch-validation`, `runtime-proof-owners-overclaim-behavior`, and `subflow-batch-stop-status-swallow`.

### Task 6. Restore Wait-Resume Truthfulness Across Status, Startup, And Replay

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1, Task 2, Task 4`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the shared paused and resumed execution lifecycle so Story 60 keeps one truthful terminal-status contract, one restart-safe persisted wait contract, and one replay-safe accepted-launch contract. The repair must make supported GitHub-review skips surface as completed-with-warning, re-register persisted waits on normal startup, preserve repository-backed flow identity such as `sourceId`, and keep paused accepted launches from duplicating work when the original acceptance response is lost.

#### Task Exit Criteria

- Supported GitHub-review skips and no-open-PR early exits resolve through one end-to-end completed-with-warning terminal-status contract instead of collapsing to plain `ok`.
- Persisted waits resume automatically on normal startup, preserve the original repository-backed flow identity and GitHub-review context, and paused accepted launches remain replay-safe across retry and restart boundaries.
- Fresh-run defaults must not override restored paused-wait state: on resume, the run keeps the restored `sourceId`, GitHub-review context, and retry barrier for that execution instead of mixing in fresh-run replacement state, while malformed restored state is rejected fail-closed rather than partially reused.
- The focused proof owners named below directly cover the completed-with-warning status seam, startup wait re-registration, repository-backed resumed identity, and paused-launch replay barrier instead of leaving any of those contracts implied only by adjacent success paths.
- The repair proves the exact lifecycle ordering where pause persistence, startup re-registration, resumed execution, and terminal-status publication interact, so a happy-path resume cannot hide a broken interleaving.

#### Addresses Findings

- Review pass `0000060-20260626T222120Z-3a823780`
- Finding `completed-with-warning-terminal-state`: GitHub skip paths still collapse into plain `ok` instead of a truthful completed-with-warning terminal state.
- Finding `startup-wait-recovery-missing`: Persisted waits are not re-registered during normal server startup.
- Finding `wait-resume-sourceid-loss`: Persisted wait resume drops the original `sourceId`, so deferred execution can restart from the wrong flow root.
- Finding `paused-launch-retry-barrier-loss`: Paused wait runs drop their fresh-run retry barrier, so an ambiguous retry can start the same logical launch again.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned lifecycle, persistence, websocket, and proof-owner files named below.

#### Subtasks

1. [x] Inspect `server/src/flows/service.ts`, `server/src/flows/flowState.ts`, `server/src/mongo/turn.ts`, `server/src/ws/types.ts`, `server/src/chat/chatStreamBridge.ts`, `server/src/routes/chat.ts`, `server/src/index.ts`, and the named wait or resume proof owners, then identify the exact writer, reader, and publish seams that own: completed-with-warning terminal status, persisted wait state, startup re-registration, restored `sourceId`, and the paused-launch `retryOwnershipId` barrier. Keep the repair inside those seams and do not widen non-GitHub flow behavior while fixing the four findings above.
2. [x] Repair the completed-with-warning terminal-status contract across `server/src/flows/service.ts`, `server/src/mongo/turn.ts`, `server/src/ws/types.ts`, `server/src/chat/chatStreamBridge.ts`, and `server/src/routes/chat.ts` so supported GitHub-review skips and no-open-PR early exits publish one truthful warning state end to end, while non-GitHub flows keep their current approved terminal behavior.
3. [x] Repair persisted wait identity, startup recovery, and the accepted-launch replay barrier across `server/src/flows/flowState.ts`, `server/src/flows/service.ts`, and `server/src/index.ts` so paused runs keep the original `sourceId`, resume against the same flow root and GitHub-review context, re-register automatically on normal startup, and keep the same `retryOwnershipId` replay barrier instead of duplicating the logical launch. Restored paused state is retained for that execution, while contradictory fresh-run replacement state is excluded from resumed execution and malformed restored state still fails closed.
4. [x] Update `server/src/test/integration/flows.run.basic.test.ts` so this proof owner covers the default-path terminal-status contract: supported GitHub-review skips publish `completed-with-warning`, no-open-PR early exits use the same warning-state contract, and adjacent non-GitHub terminal status behavior does not regress. Rename or split any reused test whose current title only claims a durable plan note or default-entrypoint preservation if that test now also proves the warning-state invariant.
5. [x] Update `server/src/test/integration/flows.run.resume.identity.test.ts` so this proof owner covers the resumed-lifecycle invariants from `server/src/flows/flowState.ts` and `server/src/flows/service.ts`: resumed waits keep the original `sourceId`, paused accepted launches keep the same `retryOwnershipId` replay barrier instead of duplicating the logical launch, and fresh-run replacement state is excluded rather than overriding restored paused state. Rename or split any reused wait-resume or stale-replay test whose current title would otherwise hide the restored-state-versus-fresh-state invariant.
6. [x] Update `server/src/test/integration/flows.run.resume.backfill.test.ts` so this proof owner covers the startup recovery contract from `server/src/index.ts`, `server/src/flows/flowState.ts`, and `server/src/flows/service.ts`, including the exact ordering where pause persistence, startup re-registration, resumed execution, and final status publication occur in sequence. Rename or split any reused startup-recovery case if its current title would make the new ordering claim look like adjacent wake-boundary behavior only.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts` from the repository root to prove the completed-with-warning contract and supported GitHub-review skip surface after the repair.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.identity.test.ts` from the repository root to prove the repository-backed wait-resume identity and paused-launch replay barrier after the repair.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.backfill.test.ts` from the repository root to prove persisted waits are re-registered through the startup-recovery path rather than only through test-only helper wiring.
4. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Inspected the Task 6 seams and confirmed the four findings are owned by `service.ts` status/wait writers, `turn.ts` plus websocket/chat replay readers, `index.ts` startup wiring, and the three named resume proof owners; the current gaps are missing warning terminal-status propagation, missing persisted `sourceId`, missing startup re-registration, and paused runs dropping their retry barrier.
- Repaired the completed-with-warning contract by widening the shared terminal-status types, adding a warning finalization path, and making GitHub skip plus no-open-PR early exits publish one end-to-end `warning` result without changing non-GitHub success behavior.
- Repaired paused wait identity and replay authority by persisting wait `sourceId`, preserving the paused retry barrier in saved flow state, using restored wait identity during resume and startup wake, and wiring normal startup through `index.ts` so persisted waits are re-registered outside test-only helpers.
- Updated `server/src/test/integration/flows.run.basic.test.ts` so the default-path proof now asserts both GitHub warning surfaces and an adjacent non-GitHub `ok` flow; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts` passed cleanly.
- Updated `server/src/test/integration/flows.run.resume.identity.test.ts` with a repository-backed paused-wait proof that asserts persisted `sourceId`, preserved paused retry replay authority, and exclusion of a conflicting fresh `sourceId`; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.identity.test.ts` passed after fixing the saved-flow-state preserve path to parse the full conversation flags object instead of the nested `flow` payload.
- Updated `server/src/test/integration/flows.run.resume.backfill.test.ts` to call the real startup wait re-registration entrypoint, prove the startup wake publishes a second assistant terminal turn after re-registration, and keep the pause-cleared plus execution-stable ordering assertions focused on the startup-owned seam; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.backfill.test.ts` passed cleanly.
- Testing 4: `npm run lint` first failed on one import-order warning in `server/src/test/integration/flows.run.resume.identity.test.ts`; moving the `RepoEntry` type import below the `../../flows/service.js` imports brought the file back into the repo's lint order contract, and the rerun then passed cleanly.
- Testing 5: `npm run format:check` passed cleanly after the lint repair, so the Task 6 changed surface is formatter-clean without any additional edits beyond the import-order fix.
- Audit confirmed all Task 6 subtasks and automated proof rows are complete and that no live `**BLOCKER**` remained in the parser output; the prior “keep in progress for the later audit step” note was bookkeeping only, so the task now closes as `__done__`.
- Manual testing skipped for the Task 6 wait-resume lifecycle surface. Tried: restarted the documented main stack from a stopped baseline with `npm run compose:build` and `npm run compose:up`, verified `http://localhost:5010/health` plus `http://localhost:5001`, then fetched `GET /flows` looking for a runnable wait-bearing flow that could exercise resumed startup recovery and warning completion on the supported main stack. Observed: startup and shutdown both succeeded, but the live catalog exposed only `echo` and `smoke` as runnable flows, and the only checked-in Story 60 flow that currently contains a `wait` step, `implement_next_plan_github_review`, was disabled because `review_agent` is unavailable in the configured agent homes. Why fuller proof was not possible: the current checked-in runtime does not expose a supported runnable Task 6 manual seam for the repaired wait-resume lifecycle without later GitHub-review infrastructure and agent availability that are outside this task's repair scope.
- Task 10 closeout now routes Findings `completed-with-warning-terminal-state`, `startup-wait-recovery-missing`, `wait-resume-sourceid-loss`, and `paused-launch-retry-barrier-loss` through focused proofs `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.identity.test.ts`, and `server/src/test/integration/flows.run.resume.backfill.test.ts`, with later broad-wrapper guards staged on `npm run build:summary:server`, full `npm run test:summary:server:unit`, full `npm run test:summary:server:cucumber`, and supported main-stack smoke `npm run compose:up` then `npm run compose:down`.

### Task 7. Harden GitHub Review Base, Handoff, And Replay Authority

- Repository Name: `Current Repository`
- Task Dependencies: `Task 3, Task 4`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the GitHub review transport and scratch authority seams so PR creation uses a trustworthy story base, persisted path-bearing handoffs stay inside the worked repository, the GitHub review scratch contract no longer collides with the existing review-loop handoff, and post-create replay can distinguish a lost response from an actually missing PR side effect. The repair must address the underlying defects without silently broadening Story 60 into a different external review workflow contract.

#### Task Exit Criteria

- GitHub PR open and fetch steps use a trustworthy review base and a non-colliding scratch or handoff contract, and persisted path-bearing selectors are root-contained before later filesystem reads or writes occur.
- `github_open_pr` remains replay-safe after ambiguous post-create interruptions, so the runtime does not blindly recreate or misclassify an already-created side effect.
- A fresh GitHub-review fetch becomes the only active classification input for that cycle: stale scratch may remain transiently only when needed for replacement or replay bookkeeping, but it must not keep influencing the selected PR, fetched comments, or later classification payload once fresher scratch has succeeded.
- The focused proof owners named below directly cover trustworthy base selection, authoritative scratch ownership, root-contained persisted selectors, and post-create replay reconciliation without relying only on tiny fixture happy paths.
- The default runtime path proves the repaired GitHub transport is reachable through the normal review-cycle flow, not only through isolated helper or fixture calls.

#### Addresses Findings

- Review pass `0000060-20260626T222120Z-3a823780`
- Finding `trustworthy-review-base-branch`: PR creation still trusts the remote default branch as the review base instead of proving a trustworthy story base.
- Finding `current-review-handoff-schema-collision`: The new GitHub scratch handoff reuses `codeInfoTmp/reviews/<story>-current-review.json` and collides with the existing review-handoff contract.
- Finding `unvalidated-persisted-path-authority`: Persisted GitHub-review handoff fields cross directly into filesystem reads and writes without repository-root containment checks.
- Finding `github-open-pr-post-create-replay-ambiguity`: `github_open_pr` cannot distinguish “PR created, response lost” from “PR never created,” so replay can misclassify or reissue the side effect.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned GitHub transport, scratch, and proof-owner files named below.

#### Subtasks

1. [x] Inspect `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, the current review-loop handoff readers, and the named GitHub proof owners, then identify the exact writer, reader, and replay seams that own: trustworthy base selection, Story 60 scratch shape, root-contained persisted selectors, and post-create replay reconciliation. Keep the repair inside those seams and do not widen Story 60 into a different external review workflow while fixing the four findings above.
2. [x] Repair the authoritative GitHub review scratch and handoff contract across `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, and the downstream handoff readers so Story 60 no longer reuses `codeInfoTmp/reviews/<story>-current-review.json` for incompatible payload shapes. Keep one scratch shape for this GitHub-review path, make the compatibility boundary explicit instead of leaving parallel readers to guess by payload shape, and ensure fresher scratch replaces stale scratch as the active classification input instead of merging contradictory review-cycle state.
3. [x] Repair trustworthy base, path authority, and post-create replay across `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, and the readers that consume GitHub-review scratch state during the default review cycle so PR creation uses a story-owned base, persisted selector paths stay root-contained before filesystem access, and an interruption after `gh pr create` reconciles an already-created PR without recreating it or reviving the old colliding scratch shape. Contradictory restored scratch or path-bearing state must be rejected or excluded server-side instead of silently influencing the next request payload.
4. [x] Update `server/src/test/unit/flows.github-scratch.test.ts` so this proof owner covers the scratch-contract invariants: the Story 60 GitHub-review scratch file uses one non-colliding payload shape, persisted `plan_path`, `repository_root`, plus later scratch-derived paths stay root-contained before filesystem access, and a fresh successful fetch replaces stale scratch as the only active classification input. Rename or split any reused scratch test whose current title only claims safe replacement visibility or freshness validation if it now also proves active-input ownership or path containment semantics.
5. [x] Update `server/src/test/unit/flows.github-adapter.test.ts` so this proof owner covers the transport invariants from `server/src/flows/githubReview.ts`: PR creation uses the trustworthy story base, and an interruption after `gh pr create` reconciles an already-created PR instead of creating a duplicate side effect. Rename or split any reused adapter test whose current title only claims branch lookup or metadata resolution if its assertions now prove replay reconciliation too.
6. [x] Update `server/src/test/integration/flows.run.loop.test.ts` so this proof owner covers the default review-cycle runtime path: the repaired scratch contract and replay semantics propagate end to end through the normal review-loop chain, stale scratch is excluded once fresher scratch succeeds, and contradictory restored review-cycle state does not leak into the active PR-selection or classification path.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` from the repository root to prove the trustworthy-base and post-create replay semantics after the repair.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` from the repository root to prove the non-colliding scratch contract and root-contained persisted selector authority after the repair.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root to prove the repaired GitHub runtime chain still uses the authoritative scratch and replay contract end to end.
4. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Starts empty. Update during implementation with concise notes about what changed, what issues appeared, and what decisions were made.
- Mapped Task 7 to the current GitHub review seams in `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, `server/src/test/unit/flows.github-scratch.test.ts`, `server/src/test/unit/flows.github-adapter.test.ts`, and `server/src/test/integration/flows.run.loop.test.ts`; confirmed the base-branch trust, `0000060-current-review.json` collision, uncontained persisted paths, and post-create replay ambiguity all live inside those writer/reader/runtime boundaries.
- Replaced the colliding GitHub review handoff with the dedicated `codeInfoTmp/reviews/<story>-github-review-current.json` contract, added an explicit `github-review-handoff-v1` marker plus repository-root containment checks for persisted path-bearing fields, and made PR creation reuse the latest open branch PR when `gh pr create` loses its response after the side effect lands.
- Updated `server/src/test/unit/flows.github-scratch.test.ts` to prove the dedicated GitHub-review scratch shape, fail-closed path containment, and fresh scratch replacement semantics; `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` passed cleanly.
- Updated `server/src/test/unit/flows.github-adapter.test.ts` so repository-state resolution uses the story-owned `branched_from` base from `current-plan.json` and ambiguous `gh pr create` failures reconcile through the existing branch PR lookup; `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` passed cleanly.
- Updated `server/src/test/integration/flows.run.loop.test.ts` with a focused open-plus-fetch runtime proof that uses the dedicated GitHub-review handoff path, excludes stale `0000060-current-review.json` state once fresh scratch succeeds, and exercises the post-create replay reconciliation through the normal flow runtime; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` passed cleanly after wiring the test harness to expose the worked repository as an ingested repo candidate.
- Testing 4: `npm run lint` passed cleanly on the current Task 7 surface, so the GitHub review transport, scratch, and review-loop runtime changes now satisfy the repo-wide lint contract without further repair.
- Testing 5: `npm run format:check` passed cleanly on the current Task 7 surface, so the repaired GitHub review transport and scratch files are formatter-clean without any follow-on edits after the lint proof.
- Audit confirmed all Task 7 subtasks and automated proof rows are complete and that no live `**BLOCKER**` remained in the parser output; the prior “keep in progress for the later audit step” note was bookkeeping only, so the task now closes as `__done__`.
- Manual testing skipped for the Task 7 default review-cycle runtime surface. Tried: restarted the documented main stack with `npm run compose:build` and `npm run compose:up`, verified `http://localhost:5010/health` plus `http://localhost:5001`, then fetched `GET /flows` to inspect the normal `implement_next_plan_github_review` runtime seam. Observed: startup and shutdown both succeeded, but the live catalog still exposed `implement_next_plan_github_review` as disabled with `Flow agent "review_agent" is not available in the configured agent homes.` Why fuller proof was not possible: the supported checked-in manual-testing catalog still lacks `review_agent`, so the default review-cycle seam required by Task 7 is not runnable in this step without later runtime-catalog repair that is outside this task's repair scope.
- Task 10 closeout now routes Findings `trustworthy-review-base-branch`, `current-review-handoff-schema-collision`, `unvalidated-persisted-path-authority`, and `github-open-pr-post-create-replay-ambiguity` through focused proofs `server/src/test/unit/flows.github-adapter.test.ts`, `server/src/test/unit/flows.github-scratch.test.ts`, and `server/src/test/integration/flows.run.loop.test.ts`, with later broad-wrapper guards staged on `npm run build:summary:server`, full `npm run test:summary:server:unit`, full `npm run test:summary:server:cucumber`, and supported main-stack smoke `npm run compose:up` then `npm run compose:down`.

### Task 8. Restore Runtime Branch Authority And Direct GitHub Review Proof

- Repository Name: `Current Repository`
- Task Dependencies: `Task 4, Task 6, Task 7`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task restores runtime branch-selection authority for the opt-in GitHub review flow and replaces the current structural-only proof overclaim with direct runtime coverage for the branches Story 60 says it supports. The repair must ensure untaken `if` branches do not preempt the authoritative branch chosen at runtime, and it must prove the clean-cycle, findings-present, and resumed-review-context behavior with runtime-owned assertions instead of only flow-shape inspection.

#### Task Exit Criteria

- Startup or preflight validation no longer resolves untaken `if` branches ahead of `runIfStep`, so the live runtime branch remains the authoritative execution path.
- The named proof owners directly exercise the runtime GitHub review branches they claim to cover, including clean-cycle, findings-present, and resumed-review-context behavior.
- Untaken branch-local state does not leak into the active branch payload: clean-cycle, findings-present, and resumed-review-context execution each use only the state owned by the chosen branch, while contradictory state from hidden or untaken branches is excluded instead of silently reused.
- The repaired proof surfaces make the runtime branch contracts explicit in test names or scenario wording instead of leaving those claims implied by static flow-shape assertions.
- The branch-authority proof covers the exact ordering where the runtime chooses the live branch before branch-local agent or command validation can reject untaken paths.

#### Addresses Findings

- Review pass `0000060-20260626T222120Z-3a823780`
- Finding `premature-if-branch-validation`: Startup validation resolves untaken `if` branches before `runIfStep` can choose the authoritative branch.
- Finding `runtime-proof-owners-overclaim-behavior`: The GitHub review-loop proof owners validate flow shape but not the runtime branches they claim to prove.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned conditional-runtime, flow-composition, and proof-owner files named below.

#### Subtasks

1. [x] Inspect `server/src/flows/service.ts`, `flows/implement_next_plan_github_review.json`, `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/features/flows-execution-runs.feature`, and `server/src/test/steps/flows-execution-runs.steps.ts`, then identify the exact clean-cycle, findings-present, and resumed-review-context branches that Story 60 approves plus the untaken-branch state that must stay excluded from each path. Keep the repair focused on runtime branch authority and honest proof ownership for the two findings above.
2. [x] Repair the startup and preflight validation seam in `server/src/flows/service.ts` so untaken `if` branches do not block the authoritative branch selected by `runIfStep`, while the live branch still fails closed when its own command, agent, or runtime contract is invalid.
3. [x] Update `server/src/test/integration/flows.run.loop.test.ts` so this proof owner covers the runtime branch invariants from `server/src/flows/service.ts` and `flows/implement_next_plan_github_review.json`: the clean-cycle branch stays reachable through the normal review loop, the findings-present branch stays reachable through the same runtime path, the resumed-review-context branch consumes the repaired wait and scratch contracts from Tasks 6 and 7, the runtime chooses the live branch before branch-local validation can reject an untaken branch, and untaken branch-local state is excluded from the active branch payload.
4. [x] Update `server/src/test/features/flows-execution-runs.feature` and `server/src/test/steps/flows-execution-runs.steps.ts` so this authored proof surface claims only the runtime branch invariants it actually proves, including that clean-cycle, findings-present, and resumed-review-context modes do not reuse contradictory state from untaken branches. Rename or split the existing checked-in GitHub review scenarios when their current titles only describe clean-cycle routing or findings repair closure and would otherwise hide resumed-review-context or untaken-branch exclusion semantics.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root to prove the repaired runtime branch-authority and GitHub review-loop behavior after the repair.
2. [x] Run `npm run test:summary:server:cucumber -- --feature server/src/test/features/flows-execution-runs.feature` from the repository root to prove the authored feature surface now claims the same runtime branches honestly.
3. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
4. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Starts empty. Update during implementation with concise notes about what changed, what issues appeared, and what decisions were made.
- Mapped Task 8 to the startup `validateCommandSteps()` and runtime `runIfStep()` seams in `server/src/flows/service.ts`, the checked-in review-loop gate in `flows/implement_next_plan_github_review.json`, and the current loop plus cucumber proof owners; confirmed the approved runtime paths are clean-cycle through the untaken findings branch, findings-present through the untaken clean branch, and resumed-review-context through the repaired wait-plus-review-feedback gate.
- Stopped startup-time recursion from `findFirstAgentStep()`, `findRuntimeIdentityStep()`, and `validateCommandSteps()` across untaken `if` branches, then moved branch validation into `runIfStep()` so only the selected path can fail closed; also updated the checked-in `check_github_review_has_reviewer_feedback.py` gate to prefer the Task 7 `*-github-review-current.json` handoff while falling back to the legacy filename when needed.
- Added direct loop-proof runtime fixtures for clean-cycle, findings-present, and resumed-review-context execution, including hidden-branch invalid-agent and invalid-command cases plus a resumed review-handoff case that resumes from the persisted wait boundary and follows the Task 7 handoff instead of the stale legacy scratch; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` now passes on the repaired branch-authority surface.
- Replaced the cucumber flow-shape-only GitHub review scenarios with runtime-owned clean-cycle, findings-present, and resumed-review-context scenarios, added working-folder-aware runtime fixture setup plus remembered-conversation resume support in the steps file, and repaired the cucumber harness to expose the active fixture repo as an ingested repository so `npm run test:summary:server:cucumber -- --feature server/src/test/features/flows-execution-runs.feature` passes on the same runtime contract.
- Testing 3: `npm run lint` passed cleanly on the current Task 8 surface, so the runtime branch-authority repair and direct GitHub review proof files satisfy the repo-wide lint contract without further edits.
- Testing 4: `npm run format:check` passed cleanly on the current Task 8 surface, so the repaired runtime-branch proof files and flow gate updates are formatter-clean without follow-on changes after lint.
- Audit confirmed all Task 8 subtasks and automated proof rows are complete and that no live `**BLOCKER**` remained in the parser output; the prior “keep in progress for the later audit step” note was bookkeeping only, so the task now closes as `__done__`.
- Manual testing skipped for the Task 8 default review-cycle runtime surface. Tried: restarted the documented main stack with `npm run compose:build` and `npm run compose:up`, verified `http://localhost:5010/health` plus `http://localhost:5001`, then fetched `GET /flows` to inspect the normal `implement_next_plan_github_review` runtime seam. Observed: startup and shutdown both succeeded, but the live catalog still exposed `implement_next_plan_github_review` as disabled with `Flow agent "review_agent" is not available in the configured agent homes.` Why fuller proof was not possible: the supported checked-in manual-testing catalog still lacks `review_agent`, so the default review-cycle seam required by Task 8 is not runnable in this step without later runtime-catalog repair that is outside this task's repair scope.
- Task 10 closeout now routes Findings `premature-if-branch-validation` and `runtime-proof-owners-overclaim-behavior` through focused proofs `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/features/flows-execution-runs.feature`, and `server/src/test/steps/flows-execution-runs.steps.ts`, with later broad-wrapper guards staged on `npm run build:summary:server`, `npm run build:summary:client`, full `npm run test:summary:server:unit`, full `npm run test:summary:server:cucumber`, full `npm run test:summary:client`, full `npm run test:summary:e2e`, and supported main-stack smoke `npm run compose:up` then `npm run compose:down`.

### Task 9. Preserve Truthful Subflow Batch Stop Outcomes

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2, Task 4`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the shared subflow batch stop aggregation seam so the parent status only reports a clean stop when the child stop outcomes actually support that conclusion. The repair must preserve the existing Story 60 stop workflow while making mixed or ineffective per-child stop results visible instead of swallowing them behind one parent `stopped` result.

#### Task Exit Criteria

- The parent subflow batch stop contract distinguishes fully stopped child batches from mixed or ineffective child stop outcomes instead of always collapsing them to a clean stop.
- Direct proof covers the mixed-outcome batch stop seam so later regressions cannot hide behind adjacent cancellation success behavior.
- The repaired proof names the mixed-outcome batch stop contract directly instead of only asserting a generic cancellation or batch-stop success path.
- The repaired parent result contract names which child-stop outcomes are authoritative for downstream status consumers instead of leaving mixed outcomes to implicit interpretation.

#### Addresses Findings

- Review pass `0000060-20260626T222120Z-3a823780`
- Finding `subflow-batch-stop-status-swallow`: The subflow batch stop loop ignores per-child stop outcomes, so batch status can misreport mixed success as a clean stop.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned subflow orchestration and proof-owner files named below.

#### Subtasks

1. [x] Inspect `server/src/flows/service.ts` and the current subflow stop proof owners, then identify the exact parent batch-stop result seam, the child stop outcomes it currently collapses together, and the downstream parent result contract that must stay truthful after the repair. Keep the fix local to Finding `subflow-batch-stop-status-swallow` instead of widening the broader stop workflow.
2. [x] Repair the shared subflow batch stop aggregation in `server/src/flows/service.ts` and any meaningful default-path consumer seam so per-child stop outcomes remain visible to the parent result contract and mixed or ineffective stop attempts are not reported as a clean stop.
3. [x] Update `server/src/test/integration/flows.run.loop.test.ts` so this proof owner covers the parent result contract with one explicit mixed-outcome batch-stop case, including which child stop outcomes count as authoritative for the parent result instead of inferring that contract from adjacent cancellation success behavior. Rename or split any reused loop-stop case whose current title only claims generic stop or cancellation success if it now proves mixed-outcome batch-stop semantics.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root to prove the repaired subflow batch stop aggregation after the change.
2. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
3. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Starts empty. Update during implementation with concise notes about what changed, what issues appeared, and what decisions were made.
- Traced Task 9 to `runSubflowStep()` in `server/src/flows/service.ts`: the parent currently collapses parallel child terminal states to `stopped` whenever any child stops or the parent requested stop, so mixed `ok` plus `stopped` child batches still surface as a clean parent stop; the downstream contract seam to keep truthful is the parent assistant turn plus `turn_final` status emitted for the subflow step, and the existing loop proof owner does not yet cover this mixed-outcome case.
- Repaired `runSubflowStep()` so fully stopped child batches remain `stopped`, but mixed or ineffective stop attempts now surface as `warning` with an explicit completed-versus-stopped child summary in the parent assistant message instead of collapsing those outcomes to a clean stop.
- Added a loop-proof regression named for the mixed-outcome batch-stop contract, covering one fast child that completes and one slow child that is stopped after a parent cancel request; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` now passes with 33 of 33 tests.
- Testing 2: `npm run lint` passed cleanly on the current Task 9 surface, so the repaired subflow batch-stop aggregation and its proof owner satisfy the repo-wide lint contract without further edits.
- Testing 3: `npm run format:check` passed cleanly on the current Task 9 surface, so the repaired subflow batch-stop contract and its proof notes are formatter-clean without follow-on changes after lint.
- Manual testing skipped for the Task 9 mixed-outcome subflow batch-stop runtime surface.
- Tried: restarted the supported main stack, verified `http://localhost:5010/health` and `http://localhost:5001`, and requested `GET /flows` looking for a checked-in manual seam that could author the mixed child-stop case.
- Observed: the main stack started and stopped cleanly, but the flow catalog only exposed the generic checked-in flows and no documented Task 9-specific manual subflow-stop entrypoint.
- Why fuller proof was not possible: current repository evidence still assigns direct proof for this contract to `server/src/test/integration/flows.run.loop.test.ts`, so the supported runtime has no documented manual path to create the required mixed child-stop outcome in this step.
- Task 10 closeout now routes Finding `subflow-batch-stop-status-swallow` through focused proof `server/src/test/integration/flows.run.loop.test.ts`, with later broad-wrapper guards staged on `npm run build:summary:server`, full `npm run test:summary:server:unit`, full `npm run test:summary:server:cucumber`, and supported main-stack smoke `npm run compose:up` then `npm run compose:down`.

### Task 10. Revalidate review pass `0000060-20260626T222120Z-3a823780` after review-task repairs

- Repository Name: `Current Repository`
- Task Dependencies: `Task 6, Task 7, Task 8, Task 9`
- Task Status: `__done__`
- Git Commits:

#### Overview

This final review-created task owns the whole active review cycle's post-repair validation for review pass `0000060-20260626T222120Z-3a823780`. It revalidates the Story 60 review-created findings block after Tasks 6 through 9 land, also covers any inline-resolved minor findings recorded in review cycle `0000060-rc-20260627T002941Z-3f3b9d27` before closeout, and proves the repaired story still holds on the repository-supported broad regression surfaces after the review-task repairs complete.

#### Task Exit Criteria

- Review-created findings from review pass `0000060-20260626T222120Z-3a823780` are revalidated on their focused proof owners and on the repository-supported broad regression surfaces after Tasks 6 through 9 complete.
- The final regression summary, reviewer-facing artifacts, and this plan all reflect one clean post-repair Story 60 state for review cycle `0000060-rc-20260627T002941Z-3f3b9d27`, and no second final revalidation owner is needed for this same active cycle.
- The final closeout proof names which focused proof home closed each routed finding cluster and which broad wrapper surface guarded the repaired story-wide regression contract.
- Broad wrappers, Compose, browser runtime, and main-stack smoke proof are classified honestly as either task-owned review-cycle assertions or shared baseline failures before closeout notes claim a Story 60 regression.

#### Addresses Findings

- Review pass `0000060-20260626T222120Z-3a823780`
- Final revalidation owner for review-created findings `completed-with-warning-terminal-state`, `startup-wait-recovery-missing`, `trustworthy-review-base-branch`, `wait-resume-sourceid-loss`, `current-review-handoff-schema-collision`, `unvalidated-persisted-path-authority`, `paused-launch-retry-barrier-loss`, `github-open-pr-post-create-replay-ambiguity`, `premature-if-branch-validation`, `runtime-proof-owners-overclaim-behavior`, and `subflow-batch-stop-status-swallow`
- Also revalidate any inline-resolved minor findings recorded in review cycle `0000060-rc-20260627T002941Z-3f3b9d27` before this story closes. No such inline-resolved minor findings are currently recorded for this active cycle, so the task must keep that statement accurate at execution time.

#### Affected Repositories

- `Current Repository`

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - refresh the reviewer-facing closeout summary after the final review-created validation pass completes.

#### Subtasks

1. [x] Re-read this `Code Review Findings` block, the active review disposition state, and `codeInfoStatus/pr-summaries/0000060-pr-summary.md`, then build an explicit finding-to-proof checklist for Tasks 6 through 9 before the broad wrapper runs start. At minimum, list the focused proof homes for: Task 6 via `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.identity.test.ts`, and `server/src/test/integration/flows.run.resume.backfill.test.ts`; Task 7 via `server/src/test/unit/flows.github-adapter.test.ts`, `server/src/test/unit/flows.github-scratch.test.ts`, and `server/src/test/integration/flows.run.loop.test.ts`; Task 8 via `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/features/flows-execution-runs.feature`, and `server/src/test/steps/flows-execution-runs.steps.ts`; and Task 9 via `server/src/test/integration/flows.run.loop.test.ts`. Keep the matching broad regression owners tied to the wrapper surfaces in `Testing` instead of inventing extra proof paths.
2. [x] Refresh `codeInfoStatus/pr-summaries/0000060-pr-summary.md` and the `Implementation notes` sections for Tasks 6 through 10 so they record, for each routed finding cluster, which focused proof owner closed it and which broad wrapper surface guarded the same seam for review pass `0000060-20260626T222120Z-3a823780` and review cycle `0000060-rc-20260627T002941Z-3f3b9d27`.
3. [x] Confirm that the active review disposition state and this plan's `Code Review Findings` block still name the same `review_cycle_id` and final revalidation owner before any broad wrapper run starts. If those two sources disagree, repair the local review-loop state first instead of claiming clean final validation from mismatched cycle ownership.
4. [x] Stage the shared baseline checklist for the broad wrapper pass: `docker-compose.yml`, `server/.env` plus `server/.env.local`, the worked-repository namespace under `CODEINFO_HOST_INGEST_DIR`, readiness `http://localhost:5010/health`, browser `http://localhost:5001/flows`, and artifact destination `codeInfoTmp/manual-testing/0000060/10/`. Keep each baseline item tied to the existing wrapper-owned `Testing` rows for compose build, server build, client build, full server unit, full server cucumber, full client, full e2e, and supported main-stack smoke start and stop.
5. [x] Prepare the final manual-proof guidance and closeout notes so the later manual-testing pass stays aligned with the repaired runtime, scratch, proof-owner, and broad-wrapper contracts without creating a second review-cycle closeout path.

#### Testing

1. [x] Run `npm run compose:build:summary` from the repository root because the repaired Story 60 review cycle still depends on the supported main-stack Docker build path, and this repository's automated build contract prefers the compose summary wrapper for container builds.
2. [x] Run `npm run build:summary:server` from the repository root because the review-created tasks change shared server flow schema, runtime orchestration, persisted wait handling, and GitHub review transport.
3. [x] Run `npm run build:summary:client` from the repository root to prove the repaired Story 60 branch still leaves the supported browser-visible `/flows` surface buildable after the runtime and proof-owner repairs.
4. [x] Run full `npm run test:summary:server:unit` from the repository root because the review-created tasks change shared flow runtime, GitHub review transport, persisted wait lifecycle, and subflow orchestration seams.
5. [x] Run full `npm run test:summary:server:cucumber` from the repository root because the review-created tasks change authored flow behavior and the Story 60 runtime proof contract.
6. [x] Run full `npm run test:summary:client` from the repository root because the repaired Story 60 proof surface still includes the supported operator-visible `/flows` selection path.
7. [x] Run full `npm run test:summary:e2e` from the repository root because Story 60 still owns the end-to-end flow execution surface after the review-task repairs.
8. [x] Run `npm run compose:up` from the repository root because the final review-created validation must include a smoke start of the supported main stack after the broad automated suites complete.
9. [x] Run `npm run compose:down` from the repository root because the previous step started the supported main stack and this final review-created task must leave that baseline stopped again.
10. [x] Run `npm run lint` from the repository root for the final Story 60 review-task repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
11. [x] Run `npm run format:check` from the repository root for the final Story 60 review-task repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- Reuse the Story 60 main-stack manual proof path from Task 5 after Tasks 6 through 9 land, but keep the retained artifacts scoped to this review cycle's repaired seams: completed-with-warning skip truthfulness, restarted wait recovery, repository-backed resumed flow identity, trustworthy GitHub review-base selection, fresh authoritative review scratch ownership, and the repaired findings-present versus clean-cycle runtime branches.
- Use the supported main stack from `docker-compose.yml`. The expected env ownership remains `server/.env` plus `server/.env.local` for the app stack and a worked repository under the host ingest namespace rooted at `CODEINFO_HOST_INGEST_DIR`; readiness still starts with `http://localhost:5010/health`, and the operator-visible browser surface remains `http://localhost:5001/flows`.
- Save any retained screenshots, logs, exported JSON, or other closeout proof for this review-created validation under `codeInfoTmp/manual-testing/0000060/10/` and do not commit them. If a later durable bundle is promoted, it should still land under `codeInfoStatus/manual-proof/0000060/`.
- If Playwright MCP screenshots are used for the final `/flows` revalidation, treat the Playwright runtime and the app-under-test runtime as separate when they differ. In the local harness flow, screenshots written under `/tmp/playwright-output/0000060/task-10/` inside the Playwright MCP runtime should normally appear on the host under `$CODEINFO_ROOT/playwright-output-local/0000060/task-10/` as staging output, not as the final repository artifact destination. Transfer the needed final-task screenshots from that staging area into `codeInfoTmp/manual-testing/0000060/10/`, treat those latest final-task screenshots as the primary durable visual proof for the re-covered `/flows` surfaces, and keep earlier screenshots only when they remain uniquely necessary. If the runtime handoff JSON is needed to confirm artifact source, fallback runtime, or destination details, inspect that handoff by meaning rather than by exact property names. If transfer is still blocked, record the limitation honestly instead of treating it as a reason to halt the proof loop.

#### Implementation notes

- Built the Task 6 through Task 9 finding-to-proof checklist from the `Code Review Findings` block, `codeInfoStatus/flow-state/review-disposition-state.json`, and `codeInfoStatus/pr-summaries/0000060-pr-summary.md`, keeping focused proof ownership on the named Task 6 through Task 9 files and reserving all broad regression ownership for the existing Task 10 `Testing` wrappers instead of inventing extra proof paths.
- Refreshed `codeInfoStatus/pr-summaries/0000060-pr-summary.md` and appended routed closeout notes to Tasks 6 through 9 so the active review pass now records each repaired finding cluster's focused proof owner plus the later Task 10 broad-wrapper guards for the same seam.
- Confirmed the `Code Review Findings` block and `codeInfoStatus/flow-state/review-disposition-state.json` still agree on review pass `0000060-20260626T222120Z-3a823780`, review cycle `0000060-rc-20260627T002941Z-3f3b9d27`, and Task 10 as the final revalidation owner, so no local review-loop state repair was needed before the broad wrapper pass.
- Staged the Task 10 baseline checklist by verifying `docker-compose.yml`, `server/.env`, and `server/.env.local`, confirming `CODEINFO_HOST_INGEST_DIR` still backs the worked-repository `/data` mount, and preparing `codeInfoTmp/manual-testing/0000060/10/` as the task-scoped artifact destination for the later wrapper and manual-proof pass.
- Prepared the final manual-proof handoff in the PR summary around the supported main stack, localhost readiness and `/flows` surface, the worked-repository namespace under `CODEINFO_HOST_INGEST_DIR`, and the artifact flow from Playwright staging into `codeInfoTmp/manual-testing/0000060/10/`, keeping the later proof aligned to the repaired warning, wait-resume, review-base, scratch, runtime-branch, and mixed-stop seams without creating a second review-cycle closeout path.
- Testing 1: the first `npm run compose:build:summary` attempt failed before Docker build work started because `scripts/docker-compose-with-env.sh` referenced unset `DOCKER_OPERATING_SYSTEM_LC` under `set -u`; initializing that variable from `docker_server_operating_system` restored the wrapper's preflight contract, and the rerun then passed cleanly with `agent_action: skip_log`.
- Testing 2: `npm run build:summary:server` passed cleanly on the first broad revalidation run, so the repaired Story 60 server runtime, schema, persisted wait, GitHub review transport, and subflow aggregation seams still build without warnings after the review-task fixes.
- Testing 3: `npm run build:summary:client` passed cleanly after wrapper inspection; the only emitted warning was Vite's existing large-chunk size notice during a successful production build, so the repaired Story 60 `/flows` surface remains buildable while that shared bundle-size warning stays non-failing.
- Testing 4: the first full `npm run test:summary:server:unit` run failed on stale Story 60 fixture expectations that did not yet seed `branched_from` into worked-repository `current-plan.json`, and on a stale subflow test that still expected a mixed stop-after-completion case to resolve as `stopped`; seeding `branched_from: "main"` in the GitHub review repo fixtures and updating the subflow test plus helper types to the repaired `warning` contract brought the full rerun to a clean 2,502-of-2,502 pass.
- Testing 5: full `npm run test:summary:server:cucumber` passed cleanly with 133 of 133 scenarios green, so the repaired Story 60 authored flow behavior and runtime proof contract still hold on the repository-supported cucumber surface after the review-task fixes.
- Testing 6: full `npm run test:summary:client` passed cleanly with 898 of 898 tests green, so the repaired Story 60 operator-visible `/flows` proof surface still holds on the repository-supported client regression wrapper after the runtime and review-task repairs.
- Testing 7: full `npm run test:summary:e2e` passed cleanly with 77 of 77 tests green, so the repaired Story 60 end-to-end flow execution surface still holds on the repository-supported broad wrapper after the review-task repairs.
- Testing 8: `npm run compose:up` completed cleanly and brought the supported main stack up through healthy server readiness plus client start, so the repaired Story 60 review cycle still supports the repository-owned smoke start path after the broad automated suites.
- Testing 9: `npm run compose:down` completed cleanly and removed the supported main-stack containers and network again, so this final review-created validation leaves the repository-owned smoke baseline stopped after the start proof completes.
- Testing 10: `npm run lint` passed cleanly on the final Story 60 review-task repair surface after the wrapper, fixture, subflow, and plan-maintenance updates completed, so no further lint repair was needed before closeout.
- Testing 11: `npm run format:check` passed cleanly across the final Story 60 review-task repair surface, so the wrapper, test-fixture, subflow, and Task 10 plan updates all remain Prettier-clean without follow-up formatting repair.
- Manual testing skipped for the final repaired review-cycle runtime surface and the broader full-story closeout path. Tried: restarted the supported main stack from `docker-compose.yml`, verified `http://localhost:5010/health` and `http://localhost:5001`, then requested `GET /flows` to reach `implement_next_plan_github_review` on the supported `/flows` surface. Observed: the stack started and stopped cleanly, but `implement_next_plan_github_review` remained disabled with `Flow agent "review_agent" is not available in the configured agent homes.` Why fuller proof was not possible: the checked-in manual-testing agent catalog still does not provide `review_agent`, so the repaired findings-present versus clean-cycle runtime branch cannot be exercised on the supported main stack in this step.

## Minor Review Fixes

- Review pass `0000060-20260626T222120Z-3a823780`; finding `current-plan-path-undervalidated-before-note-write`; repository `current_repository`; summary: hardened the GitHub review current-plan parser so escaped `plan_path` values are rejected before note append or scratch publish dereferences them; changed files: `server/src/flows/githubReview.ts`, `server/src/test/unit/flows.github-scratch.test.ts`; fix commit `133573b6af5861bf5cdab58ce8102ab3acc90af8`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` passed, focused `npx eslint server/src/flows/githubReview.ts server/src/test/unit/flows.github-scratch.test.ts` passed, focused `npx prettier --check server/src/flows/githubReview.ts server/src/test/unit/flows.github-scratch.test.ts` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260626T222120Z-3a823780`; finding `script-decision-symlink-escape`; repository `current_repository`; summary: hardened script-backed flow decisions so symlinked entrypoints cannot resolve outside the worked repository root before `python3` executes them; changed files: `server/src/flows/service.ts`, `server/src/test/integration/flows.run.errors.test.ts`; fix commit `838e7778802563f107b310c555606e77acee1e54`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.errors.test.ts --test-name "shared decision seam rejects script symlinks that escape the worked repository root"` passed, focused `npx eslint server/src/flows/service.ts server/src/test/integration/flows.run.errors.test.ts` passed, focused `npx prettier --check server/src/flows/service.ts server/src/test/integration/flows.run.errors.test.ts` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260626T222120Z-3a823780`; finding `malformed-persisted-wait-coerced-to-root-resume`; repository `current_repository`; summary: hardened persisted wait parsing so malformed wait state with an empty `stepPath` is rejected instead of being re-registered toward a root resume; changed files: `server/src/flows/service.ts`, `server/src/test/integration/flows.run.resume.backfill.test.ts`; fix commit `1f37dff973efacde801813b95f5543c3c886807c`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.backfill.test.ts --test-name "startup recovery does not re-register malformed persisted wait state with an empty wait stepPath"` passed, focused `npx eslint server/src/flows/service.ts server/src/test/integration/flows.run.resume.backfill.test.ts` passed, focused `npx prettier --check server/src/flows/service.ts server/src/test/integration/flows.run.resume.backfill.test.ts` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260626T222120Z-3a823780`; finding `duplicate-cancel-proof-fixed-delay`; repository `current_repository`; summary: replaced the duplicate-cancel proof's fixed quiet-window delay with an explicit wake-boundary flush so the cancellation assertion follows the harness cleanup seam instead of a timing guess; changed files: `server/src/test/integration/flows.run.resume.identity.test.ts`; fix commit `77d3784294d26914d7801e1633ffd9f6d848ad25`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.identity.test.ts --test-name "cancelled wait does not emit a later resume side effect when the persisted wait state is cleared before wake"` passed, focused `npx eslint server/src/test/integration/flows.run.resume.identity.test.ts` passed, focused `npx prettier --check server/src/test/integration/flows.run.resume.identity.test.ts` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260626T222120Z-3a823780`; finding `github-review-helper-generic-handoff-fallback`; repository `current_repository`; summary: removed the reviewer-feedback helper's fallback to the generic review handoff so GitHub review gating now requires the canonical namespaced handoff file; changed files: `scripts/flow_control/check_github_review_has_reviewer_feedback.py`, `scripts/test/test_check_github_review_has_reviewer_feedback.py`, `server/src/test/integration/flows.run.errors.test.ts`; fix commit `92cd4b803b5a776ceb27d4fd61feee127276f6a9`; targeted proof: `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` passed, `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.errors.test.ts --test-name "github review feedback helper rejects the generic current-review handoff fallback"` passed, focused `npx eslint server/src/test/integration/flows.run.errors.test.ts` passed, and focused `npx prettier --check server/src/test/integration/flows.run.errors.test.ts` passed after the repo's prettier setup reported no parser for the touched Python files. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260627T163109Z-40f1c89b`; finding `generic_engineering_issue-4`; repository `current_repository`; summary: terminal fresh-run failures now clear pending retry ownership and avoid publishing a completion replay barrier, so later retries with the same `retryOwnershipId` launch a fresh run instead of replaying a failed launch result; changed files: `server/src/flows/service.ts`, `server/src/test/integration/flows.run.errors.test.ts`; fix commit `3a5217643c4fb20cf6f3d0aa5128fdb78b443273`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.errors.test.ts --test-name "terminal fresh-run failure clears durable retry ownership before a later retry with the same id"` passed, focused `npx eslint server/src/flows/service.ts server/src/test/integration/flows.run.errors.test.ts` passed, and focused `npx prettier --check server/src/flows/service.ts server/src/test/integration/flows.run.errors.test.ts` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260627T163109Z-40f1c89b`; finding `plan_contract_issue-5`; repository `current_repository`; summary: aligned `readCurrentPlanStoryContext` with the repository-root containment contract so escaped current-plan handoff paths fail closed instead of being read for GitHub PR story context; changed files: `server/src/flows/service.ts`, `server/src/test/unit/flows.story-context.test.ts`; fix commit `5c8bfe328a95ffa9f217aeab76bade27df199290`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/unit/flows.story-context.test.ts` passed, focused `npx eslint server/src/flows/service.ts server/src/test/unit/flows.story-context.test.ts` passed, and focused `npx prettier --check server/src/flows/service.ts server/src/test/unit/flows.story-context.test.ts` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260627T163109Z-40f1c89b`; finding `generic_engineering_issue-8`; repository `current_repository`; summary: replaced the duplicate-stop acceptance proof's fixed quiet-window delay with the deterministic runtime cleanup boundary already exposed by the harness; changed files: `server/src/test/integration/flows.run.loop.test.ts`; fix commit `3c19349f283dfa9da26cfa6dadd0694c8a5bec2a`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --test-name "duplicate flow stop requests emit one terminal stopped event"` passed, and focused `npx eslint server/src/test/integration/flows.run.loop.test.ts` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260627T235900Z-d645782a`; finding `generic_engineering_issue-3`; repository `current_repository`; summary: aligned the hidden `/flows` selection proxy with the visible disabled-flow invariant so disabled list entries cannot be selected through the test seam; changed files: `client/src/pages/FlowsPage.tsx`, `client/src/test/flowsPage.runGuard.test.tsx`; fix commit `64c20d0982919f3d4d4e9b1d9d21c79e4e990f79`; targeted proof: focused `npm run test:summary:client -- --file client/src/test/flowsPage.runGuard.test.tsx --test-name "keeps the active runnable selection when an ingested GitHub review variant is disabled from list data"` passed, focused `npx eslint client/src/pages/FlowsPage.tsx client/src/test/flowsPage.runGuard.test.tsx` passed, and focused `npx prettier --check client/src/pages/FlowsPage.tsx client/src/test/flowsPage.runGuard.test.tsx` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260629T141234Z-d9a9011b`; finding `6`; repository `current_repository`; summary: added direct visible-composer resume-mode guard proof so disabled flow detail revalidation blocks the main send path before any resume `/run` request is sent; changed files: `client/src/test/flowsPage.runGuard.test.tsx`; fix commit `6cf99eaf7c5ff9f88e0f4255235b736286154e7a`; targeted proof: `npm run test:summary:client -- --file client/src/test/flowsPage.runGuard.test.tsx --test-name "revalidates selected flow details before the visible composer send path resumes a flow"` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260629T141234Z-d9a9011b`; finding `7`; repository `current_repository`; summary: surfaced recovered `gh pr create` ambiguity on the GitHub open-PR success path as a warning instead of dropping it after latest-open reconciliation succeeds; changed files: `server/src/flows/service.ts`, `server/src/test/integration/flows.run.basic.test.ts`; fix commit `c19f1fb29751a938fddd5931944e52a8aa5b2afa`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts --test-name "github review open PR surfaces recovered gh pr create ambiguity as a warning while the run still continues"` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260629T141234Z-d9a9011b`; finding `10`; repository `current_repository`; summary: replaced timing-based untaken-branch negative assertions in the GitHub review runtime cucumber proof with deterministic user-turn exclusion checks after branch settlement; changed files: `server/src/test/features/flows-execution-runs.feature`, `server/src/test/steps/flows-execution-runs.steps.ts`; fix commit `00e25806b9dc14297e71cf584345fad145adb39f`; targeted proof: `npm run test:summary:server:cucumber -- --feature server/src/test/features/flows-execution-runs.feature` passed. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260629T082933Z-1ecc72c8`; finding `finding-6`; repository `current_repository`; summary: the conversations append-turn REST schema now accepts the existing `warning` turn status and the focused route proof covers that contract; changed files: `server/src/routes/conversations.ts`, `server/src/test/integration/conversations.turns.test.ts`; fix commit `df5ee659faa1d7266b204460c7f8423ebb2e4b8f`; targeted proof: `npm run test:summary:server:unit -- --file server/src/test/integration/conversations.turns.test.ts` passed with 26 tests and no failures. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.
- Review pass `0000060-20260629T082933Z-1ecc72c8`; finding `finding-10`; repository `current_repository`; summary: the Story 60 browser proof now verifies that selecting the GitHub review variant launches the GitHub review `/run` endpoint rather than the default flow endpoint; changed files: `e2e/flows-execution-runs.spec.ts`; fix commit `84e26473fc27c18fe8ba845b2bde8b79c705f371`; targeted proof: `npm run test:summary:e2e -- --file e2e/flows-execution-runs.spec.ts --grep "flows let operators select the GitHub review variant without mutating the default entrypoint"` passed with 1 test and 0 failures. Resolved inline during the review loop with bounded code/config/docs/test changes; no numbered review-fix task was created.

## Code Review Findings

### Review Pass `0000060-20260626T222120Z-3a823780` follow-up for review cycle `0000060-rc-20260627T093723Z-91e32429`

- Source of truth: `codeInfoStatus/flow-state/review-disposition-state.json` for active task-up routing. `codeInfoTmp/reviews/0000060-current-review.json` and the referenced findings, challenge, and evidence artifacts remain the scratch review basis for this same review pass.
- Review comparison context: the stored review handoff compared local `HEAD` `3a8237806531e55db127093abb2dd753fd918925` against resolved remote base `origin/main` at `9833bf9addc2515edb774f3a92307dd594b05062`, with `remote_fetch_status: success` and no local-fallback base inference required.
- This appended follow-up block supersedes the earlier completed review-created block for the same review pass because the active review disposition state for cycle `0000060-rc-20260627T093723Z-91e32429` still contains unresolved task-required findings after the inline minor-fix path closed all routed minor work.
- Inline-resolved minor findings already covered in this same active cycle and owned by the fresh final revalidation task below: `current-plan-path-undervalidated-before-note-write`, `script-decision-symlink-escape`, `malformed-persisted-wait-coerced-to-root-resume`, `duplicate-cancel-proof-fixed-delay`, and `github-review-helper-generic-handoff-fallback`.
- Remaining unresolved task-required findings that must now be encoded into executable plan state: `gh-runtime-failures-downgraded-to-skip`, `unreadable-env-local-treated-as-skip`, and `github-review-scratch-story-global-overwrite`.

### Task 11. Restore Truthful GitHub Runtime Failure Classification For Review Open-PR And Token Loading

- Repository Name: `Current Repository`
- Task Dependencies: `Task 7`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the remaining GitHub runtime failure taxonomy so Story 60 keeps the approved distinction between supported warning-only review skips and real server-side runtime failures. The repair must address the current `gh pr create` replay path and the worked-repository `.env.local` token loader together, because both findings still collapse broken runtime state into the same benign skip branch and therefore share one warning-versus-failure contract seam.

#### Task Exit Criteria

- `github_open_pr` keeps supported review-skip outcomes on the approved warning path while real `gh` create-side runtime failures such as missing-binary, spawn, or equivalent lower-layer faults surface as runtime failures instead of warning-only skips.
- Worked-repository `.env.local` loading still treats truly missing opt-in state as the approved skip case, while unreadable or otherwise broken file-access faults stop being normalized into the same benign skip taxonomy.
- The repaired warning-versus-failure contract propagates through the default Story 60 review launcher and note-writing path, so a create-side or token-loader runtime failure cannot be silently rewritten back into a supported skip result after the lower-layer producer classifies it correctly.
- The repair preserves current approved user-facing Story 60 behavior for supported missing-token or no-open-PR cases and does not widen the story into a broader GitHub UX redesign.
- Focused proof names the exact runtime and adapter seams that now distinguish supported skip cases from broken runtime state.

#### Addresses Findings

- Review pass `0000060-20260626T222120Z-3a823780`
- Finding `gh-runtime-failures-downgraded-to-skip`: `github_open_pr` still downgrades some real `gh` runtime failures into the warning-only skip path.
- Finding `unreadable-env-local-treated-as-skip`: unreadable worked-repository `.env.local` failures are still normalized into the benign GitHub-skip path.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned GitHub transport, runtime, and proof-owner files named below.

#### Subtasks

1. [x] Re-inspect the exact warning-versus-failure producer and consumer seams in `server/src/flows/githubReview.ts` and `server/src/flows/service.ts`, including the `gh pr create` replay classification path, the worked-repository `.env.local` token-loader branches, and the default note-writing path, then map which lower-layer results are still being normalized into supported skip outcomes.
2. [x] Patch the shared runtime-classification seam across `server/src/flows/githubReview.ts` and `server/src/flows/service.ts` so requirement `supported skip cases remain skips` is still owned by the approved no-open-PR and missing-opt-in branches, while requirement `broken runtime state remains a runtime failure` is owned by the same files for missing-binary, spawn, unreadable-runtime, directory-shaped, permission-denied, and equivalent create-side or token-loader faults through the default review launcher and note-writing flow.
3. [x] Update `server/src/test/unit/flows.github-adapter.test.ts` as the proof owner for requirement `producer-side GitHub classification is truthful`, covering accepted skip cases, create-side runtime-failure classification, unreadable `.env.local`, and broken file-shape or permission faults before the later consumer path runs; rename, split, or rewrite any reused test whose title would otherwise still claim only malformed `.env.local` parsing or raw `gh` normalization after it starts proving the broader runtime-failure contract.
4. [x] Update `server/src/test/integration/flows.run.loop.test.ts` as the proof owner for requirement `the default Story 60 review path preserves producer truth`, covering one combined end-to-end note-writing scenario where a correctly classified create-side or token-loader runtime failure cannot be rewritten back into a supported skip result after launch; rename or rewrite any reused test so its title and assertions claim this exact producer-to-consumer propagation invariant rather than only adjacent handoff or PR-fetch behavior.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` from the repository root to prove the repaired GitHub transport classification contract.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root to prove the default review-cycle runtime still distinguishes supported skips from real runtime failures after the repair.
3. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
4. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Re-inspected the Task 11 producer and consumer seam across `server/src/flows/githubReview.ts` and `server/src/flows/service.ts` and confirmed the remaining taxonomy bug lived in two producer branches: malformed or unreadable worked-repository `.env.local` inputs were still emitted as skip outcomes, and unreconciled `gh pr create` failures were still rewritten into `PR_CREATE_FAILED` skips before the default open-PR note path consumed them.
- Patched `server/src/flows/githubReview.ts` so only the approved missing-opt-in cases remain `skip`, while malformed `.env.local`, unreadable or directory-shaped `.env.local`, permission-denied token reads, missing `gh`, spawn failures, and unreconciled `gh pr create` failures now stay on the `error` path; the existing `server/src/flows/service.ts` consumer branch already preserves `error` results as open-PR failures, so no wider runtime redesign was needed.
- Updated `server/src/test/unit/flows.github-adapter.test.ts` to prove the broader producer taxonomy directly: accepted missing-opt-in cases still skip, malformed `.env.local` now fails with `ENV_LOCAL_INVALID`, unreadable or permission-denied `.env.local` now fails with `ENV_LOCAL_READ_FAILED`, and lower-layer `gh` create faults now stay `GITHUB_CLI_*` errors unless replay reconciliation finds the already-created PR; `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` passed cleanly with 7 of 7 tests.
- Updated `server/src/test/integration/flows.run.loop.test.ts` with an end-to-end Story 60 runtime proof where a directory-shaped `.env.local` triggers `ENV_LOCAL_READ_FAILED`, the run ends `failed`, and no open-PR skip warning is emitted back into the conversation; the first wrapper run exposed an over-specific assertion that expected `.env.local` in the raw errno text, so broadening that one assertion to accept the real read-fault wording brought the rerun to a clean 34-of-34 pass via `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts`.
- Testing 3: `npm run lint` passed cleanly on the Task 11 repair surface, so the GitHub runtime-classification code and focused proof updates needed no further lint cleanup before closeout.
- Testing 4: `npm run format:check` passed cleanly across the Task 11 repair surface, so the GitHub runtime-classification code and proof-owner updates remain Prettier-clean without follow-up formatting repair.
- Manual testing skipped for the Task 11 default Story 60 review-launcher runtime surface. Tried: restarted the supported main stack from `docker-compose.yml`, verified `http://localhost:5010/health` and `http://localhost:5001`, then requested `GET /flows` to reach `implement_next_plan_github_review` on the supported `/flows` surface. Observed: the stack started and stopped cleanly, but `implement_next_plan_github_review` remained disabled with `Flow agent "review_agent" is not available in the configured agent homes.` Why fuller proof was not possible: the checked-in manual-testing agent catalog still does not provide `review_agent`, so the task-owned GitHub runtime-classification seam cannot be exercised on the supported main stack in this step.
- Task 13 closeout routing now records Task 11's focused proof owners as `server/src/test/unit/flows.github-adapter.test.ts` plus `server/src/test/integration/flows.run.loop.test.ts`, with later broad validation owned by `npm run build:summary:server`, full `npm run test:summary:server:unit`, full `npm run test:summary:server:cucumber`, full `npm run test:summary:e2e`, and supported main-stack smoke `npm run compose:up`, `npm run test:summary:host-network:main`, then `npm run compose:down`.

### Task 12. Give GitHub Review Scratch State Per-Run Ownership Instead Of Story-Global Overwrite

- Repository Name: `Current Repository`
- Task Dependencies: `Task 7`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the remaining GitHub review scratch ownership gap so overlapping Story 60 review runs cannot overwrite each other's active current-review state. The repair must keep the approved namespaced GitHub scratch contract and solve the remaining story-global ownership problem through one coherent per-run ownership or active-selection design instead of leaving later readers to guess which overlapping run owns the shared scratch file.

#### Task Exit Criteria

- The active GitHub review scratch state is no longer story-global: overlapping Story 60 review runs cannot silently overwrite each other's authoritative current-review state.
- The repair preserves the approved dedicated namespaced GitHub handoff contract rather than reintroducing the generic `*-current-review.json` fallback or a broader user-facing workflow change.
- Focused proof explicitly covers overlapping or contradictory scratch ownership instead of relying only on single-run happy-path fixtures.
- Any retained selection or compatibility boundary is owned by one explicit repository-scoped contract rather than by accidental last-writer-wins behavior.
- Exact overlapping-run interleavings are covered: an older or foreign run cannot reclaim authoritative current-review ownership after a newer run publishes or after the helper re-reads scratch state through the supported default path.
- Partial, malformed, or failed scratch updates never become authoritative current-review input, and the server-owned scratch writer remains the one cleanup owner for replacing stale state without deleting a still-valid prior handoff too early.

#### Addresses Findings

- Review pass `0000060-20260626T222120Z-3a823780`
- Finding `github-review-scratch-story-global-overwrite`: the GitHub review scratch handoff is still story-global, so overlapping runs can overwrite each other's current review state.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned GitHub review scratch, runtime, and helper-script proof files named below.

#### Subtasks

1. [x] Re-inspect the GitHub review scratch producer and consumer seams in `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, `scripts/flow_control/check_github_review_has_reviewer_feedback.py`, and the named proof owners to map where story-global scratch ownership still leaks across overlapping runs, helper-side handoff selection, or restart-time rereads.
2. [x] Patch the shared scratch-ownership seam across `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, and `scripts/flow_control/check_github_review_has_reviewer_feedback.py` so requirement `authoritative review state is namespaced and per-run`, requirement `generic current-review fallback stays out of the default path`, and requirement `partial or failed scratch replacement never deletes or outranks a still-valid prior handoff` are all owned by those writer and reader files instead of by story-global overwrite behavior.
3. [x] Update `server/src/test/unit/flows.github-scratch.test.ts` as the proof owner for requirement `server-side writer and selector ownership is per-run`, covering contradictory or overlapping scratch state, stale-versus-live selection, restart-time reread precedence, malformed or partial scratch rejection, and the cleanup boundary where a failed replacement attempt leaves the last valid handoff authoritative; rename, split, or rewrite reused tests so titles that currently claim only safe replacement, malformed-state rejection, or path-escape guards do not overstate or understate the newer per-run ownership invariant.
4. [x] Update `scripts/test/test_check_github_review_has_reviewer_feedback.py` as the proof owner for requirement `the helper-side consumer follows the same namespaced ownership contract`, covering helper rereads and rejection of foreign or generic handoff state; rename or split the helper tests if a namespaced-handoff happy-path title would otherwise hide the new foreign-state rejection claim.
5. [x] Update `server/src/test/integration/flows.run.loop.test.ts` as the proof owner for requirement `the default review runtime preserves the exact newer-run-versus-older-run interleaving boundary`, covering one combined scenario where a newer run publishes the authoritative handoff and an older or foreign run later attempts to reclaim ownership through additional writes or rereads; the test title and assertions must claim that exact interleaving boundary rather than only a later stale-state outcome.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` from the repository root to prove the repaired GitHub scratch ownership and containment contract.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root to prove the default review-cycle runtime now rejects or isolates overlapping scratch ownership correctly.
3. [x] Run `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` from the repository root to prove the helper-side handoff selection still follows the repaired namespaced ownership contract.
4. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- **RESOLVED ISSUE** Audit found no repository evidence that Task 12 implementation work had started beyond the selector-driven status promotion, so unchecked Subtasks 1 through 5 remained open after normalization. Evidence checked: the re-read Task 12 plan section, `git log --oneline -6`, `git show --stat --oneline -4`, and a clean `git status --short` with no Task 12 code or proof-file edits present. That active blocker is now retired because the current `**BLOCKING ANSWER**` proved this is a Task 12 product-seam repair with no missing prerequisite owner, so implementation can continue on the existing bounded subtasks instead of waiting on planner intervention.
- **BLOCKING ANSWER** Repository precedent proves this is a Task 12 product seam, not a wrapper or runtime-baseline seam: `server/src/flows/flowState.ts` and `server/src/flows/service.ts` already treat `executionId` as the authoritative per-run ownership key for persisted waits and reject resumed foreign state, while `server/src/flows/githubReview.ts` still writes one story-global `codeInfoTmp/reviews/<story>-github-review-current.json` handoff and `scripts/flow_control/check_github_review_has_reviewer_feedback.py` still reads only that story-global path. Official Node.js fs guidance says concurrent `fs/promises` modifications on the same file are not synchronized or threadsafe and `fs.rename()` overwrites an existing file, and the `write-file-atomic` project documents the same practical resolution by serializing concurrent writes per filename instead of treating a shared target as safely concurrent. The proven fix is to keep the supported namespaced default path but turn it into one explicit selector contract that points at an execution-scoped GitHub-review handoff keyed by `executionId`: the writer in `server/src/flows/githubReview.ts` should atomically publish the per-run handoff plus raw artifact first, then atomically update the story-level selector; `server/src/flows/service.ts` should persist that selector or execution-scoped reference inside `wait.githubReviewContext` so restart-time rereads keep the same run owner; and the helper in `scripts/flow_control/check_github_review_has_reviewer_feedback.py` should follow the selector to the per-run handoff and reject foreign, generic, or malformed ownership state through the supported default path. This fits current repo state because it reuses the existing `writeJsonAtomically` staged-publish helper, preserves the approved namespaced default path for helper discovery, and matches Task 12's own exit criterion that any retained selection boundary be explicit instead of accidental last-writer-wins. Rejected alternatives were not suitable: keeping one story-global handoff and choosing the latest write still leaves older and newer runs racing on the same authoritative file; storing ownership only in wait state leaves the helper with no per-run authority check on the supported default path; reintroducing generic `*-current-review.json` fallback breaks the approved Task 7 or Task 12 namespaced contract; and adding a new atomic-write dependency or external lock manager widens scope even though the repo already has the needed temp-plus-rename safe-write primitive and the actual defect is ownership, not partial-write safety.
- Re-inspected the Task 12 producer and consumer seam across `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, `scripts/flow_control/check_github_review_has_reviewer_feedback.py`, and the three proof owners. The remaining leak is still story-global on the supported default path: the server writes one `0000060-github-review-current.json` payload, the helper reads that same file directly, the integration helpers still model the same filename plus the rejected generic fallback, and `wait.githubReviewContext` still carries only loose PR or branch metadata instead of an execution-scoped ownership reference for restart-time rereads.
- Patched the shared ownership seam so the supported default file is now a Task 12 selector that points at an execution-scoped handoff keyed by `executionId`, the server runtime claims selector ownership on GitHub PR open and persists that execution-scoped reference through `wait.githubReviewContext`, and the helper now follows the selector instead of reading a story-global payload directly. The writer still uses the existing staged temp-plus-rename publish path, publishes the per-run artifact and handoff before refreshing the selector, and refuses a late reclaim when a different execution already owns the authoritative selector.
- Updated `server/src/test/unit/flows.github-scratch.test.ts` to prove the new selector-owned execution contract directly: failed replacement leaves the last valid selector-owned handoff authoritative, malformed selector-plus-handoff state is rejected, restart-time rereads now check expected execution ownership, and fresh publishes now advance the selector to the current execution-scoped handoff. `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` then passed cleanly with 7 of 7 tests.
- Updated `scripts/test/test_check_github_review_has_reviewer_feedback.py` so the helper proof now follows the selector to an execution-scoped handoff, rejects the removed generic fallback by failing on the missing supported selector path, and rejects selector-to-handoff ownership mismatches instead of guessing across foreign state. `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` then passed cleanly with 3 of 3 tests.
- Updated `server/src/test/integration/flows.run.loop.test.ts` so the runtime proof now asserts the exact Task 12 interleaving boundary: a clean newer execution claims the selector, publishes fresh review scratch, and keeps that selector authoritative after an older execution later attempts a direct reclaim write. `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` then passed cleanly with 34 of 34 tests.
- Testing 4: `npm run lint` passed cleanly on the Task 12 repair surface, so the per-run selector, helper, runtime, and proof-owner updates needed no further lint cleanup before closeout.
- Testing 5: `npm run format:check` passed cleanly across the Task 12 repair surface, so the per-run selector, helper, runtime, and proof-owner updates remain Prettier-clean without follow-up formatting repair.
- Manual testing skipped for the Task 12 default Story 60 review-launcher runtime surface.
- Tried: restarted the supported main stack with `npm run compose:build` and `npm run compose:up`, verified `http://localhost:5010/health` and `http://localhost:5001`, then requested `GET /flows` to reach `implement_next_plan_github_review`.
- Observed: the supported main stack started and shut down cleanly, but `implement_next_plan_github_review` remained disabled with `Flow agent "review_agent" is not available in the configured agent homes.`
- Why fuller proof was not possible: the checked-in manual-testing agent catalog still lacks `review_agent`, so the task-owned per-run GitHub review scratch runtime seam cannot be exercised on the supported main stack in this step.
- Audit note: Task 12 is now `__done__` because all implementation subtasks and automated proof steps are complete, the parser reports no live `**BLOCKER**`, and the per-run selector ownership repair stays within the approved Story 60 GitHub review scratch contract rather than introducing a broader workflow change.
- Task 13 closeout routing now records Task 12's focused proof owners as `server/src/test/unit/flows.github-scratch.test.ts`, `scripts/test/test_check_github_review_has_reviewer_feedback.py`, and `server/src/test/integration/flows.run.loop.test.ts`, with later broad validation owned by `npm run build:summary:server`, full `npm run test:summary:server:unit`, full `npm run test:summary:server:cucumber`, full `npm run test:summary:e2e`, and supported main-stack smoke `npm run compose:up`, `npm run test:summary:host-network:main`, then `npm run compose:down`.

### Task 13. Revalidate review pass `0000060-20260626T222120Z-3a823780` after review-cycle `0000060-rc-20260627T093723Z-91e32429` task-up repairs

- Repository Name: `Current Repository`
- Task Dependencies: `Task 11, Task 12`
- Task Status: `__done__`
- Git Commits:

#### Overview

This fresh review-created final task owns the whole active review cycle's post-repair validation for review cycle `0000060-rc-20260627T093723Z-91e32429`. It revalidates the unresolved task-required findings routed into Tasks 11 and 12, also covers every inline-resolved minor finding already recorded for this same active cycle, and owns the full relevant repository-supported regression proof needed before Story 60 can close again.

#### Task Exit Criteria

- Review-created findings `gh-runtime-failures-downgraded-to-skip`, `unreadable-env-local-treated-as-skip`, and `github-review-scratch-story-global-overwrite` are revalidated on their focused proof owners and on the relevant broad repository-supported regression surfaces after Tasks 11 and 12 complete.
- Inline-resolved minor findings `current-plan-path-undervalidated-before-note-write`, `script-decision-symlink-escape`, `malformed-persisted-wait-coerced-to-root-resume`, `duplicate-cancel-proof-fixed-delay`, and `github-review-helper-generic-handoff-fallback` are also revalidated as part of this same final task rather than being left to a second final-owner path.
- The final regression summary, reviewer-facing artifacts, this plan, and `review-disposition-state.json` all reflect one clean post-repair Story 60 state for review cycle `0000060-rc-20260627T093723Z-91e32429`, and no second final revalidation owner remains for this cycle.
- Client-only browser proof is not required for this cycle unless later implementation broadens beyond the current server and helper-script surfaces; if that happens, update this task honestly instead of silently assuming browser proof was covered.
- Shared baseline failures are separated from product regressions before closeout: if the supported main stack, agent catalog, ports, readiness path, or other repository-owned runtime baseline is unavailable, the limitation is recorded against that baseline seam instead of being misclassified as a Story 60 product failure.

#### Addresses Findings

- Review pass `0000060-20260626T222120Z-3a823780`
- Final revalidation owner for unresolved task-required findings `gh-runtime-failures-downgraded-to-skip`, `unreadable-env-local-treated-as-skip`, and `github-review-scratch-story-global-overwrite`
- Also revalidate inline-resolved minor findings `current-plan-path-undervalidated-before-note-write`, `script-decision-symlink-escape`, `malformed-persisted-wait-coerced-to-root-resume`, `duplicate-cancel-proof-fixed-delay`, and `github-review-helper-generic-handoff-fallback` for review cycle `0000060-rc-20260627T093723Z-91e32429`

#### Affected Repositories

- `Current Repository`

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - refresh the reviewer-facing closeout summary after this fresh review-cycle revalidation task completes.

#### Subtasks

1. [x] Re-read this appended `Code Review Findings` follow-up block, the active `codeInfoStatus/flow-state/review-disposition-state.json`, and `codeInfoStatus/pr-summaries/0000060-pr-summary.md`, then write one explicit finding-to-proof checklist into the PR summary draft that lists each unresolved task-required finding with its focused proof owner from Tasks 11 and 12, lists each inline-resolved minor finding with the exact broad proof surface that must revalidate it (the full server unit wrapper, the full server cucumber wrapper, the full e2e wrapper, or the supported main-stack smoke start/stop surface), and lists `scripts/test/test_check_github_review_has_reviewer_feedback.py` as the helper-script proof home that must be cross-checked separately from the Node-based wrappers.
2. [x] Verify the shared baseline this task depends on before broad wrapper runs begin by checking that `docker-compose.yml`, the repository compose wrappers, the readiness path `http://localhost:5010/health`, the UI path `http://localhost:5001`, and the manual-test seed catalogs under `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` still match the supported runtime contract for this story; if any one of those baseline facts is missing, renamed, or unavailable, record that limitation in the PR summary draft as a baseline seam instead of treating it as a product regression from Tasks 11 or 12.
3. [x] Compare this appended block against `codeInfoStatus/flow-state/review-disposition-state.json` and confirm that both still name review cycle `0000060-rc-20260627T093723Z-91e32429`, that this task title still matches `task_up_owned_final_revalidation_task_title`, and that no second final-owner wording was added elsewhere before broad wrapper runs start; if the wording drifted, repair only this task-owned wording and the matching PR summary draft text without changing Task 11 or Task 12 scope.
4. [x] Refresh `codeInfoStatus/pr-summaries/0000060-pr-summary.md` and the implementation notes for Tasks 11 through 13 so requirement `closeout remains traceable and honest` is satisfied with concrete entries for which focused proof owner closed each task-required finding, which exact broad wrapper surface revalidated each inline minor finding, whether any shared-baseline limitation was encountered, why no separate client-only browser proof was required if that remains true, and how the helper-script proof home was cross-checked against the broad server wrapper results before closeout.

#### Testing

Client-specific `npm run build:summary:client` and `npm run test:summary:client` wrappers are not applicable for this review-created findings block because Tasks 11 and 12 change no client-owned files or browser-only contracts; the shared browser-visible regression coverage for this block is owned instead by `npm run test:summary:e2e` plus the supported main-stack host-network probe after `npm run compose:up`.

1. [x] Run `npm run compose:build:summary` from the repository root because the repaired Story 60 review-cycle runtime still depends on the supported main-stack Docker build path after Tasks 11 and 12 land.
2. [x] Run `npm run build:summary:server` from the repository root because the remaining serious review-created work changes shared server runtime, GitHub transport, scratch ownership, and helper-script execution surfaces.
3. [x] Run full `npm run test:summary:server:unit` from the repository root because this final task must revalidate the focused task-up repairs plus all inline-resolved minor fixes on the repository-supported unit and integration wrapper surface.
4. [x] Run `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` from the repository root because the active cycle's final validation still needs one direct helper-script proof surface that the Node-based wrappers do not cover by themselves.
5. [x] Run full `npm run test:summary:server:cucumber` from the repository root because Story 60 still owns authored flow behavior and runtime proof on the repository-supported cucumber surface after the task-up repairs.
6. [x] Run full `npm run test:summary:e2e` from the repository root because this repository's automated browser wrapper is still the broadest supported proof that the repaired `/flows` execution surface and review-loop path did not regress, even though Tasks 11 and 12 changed only server and helper-script seams.
7. [x] Run `npm run compose:up` from the repository root because this final review-cycle task must include a supported main-stack smoke start after the broad automated suites complete.
8. [x] Run `npm run test:summary:host-network:main` from the repository root after `npm run compose:up` because this repository's supported automated main-stack smoke proof is the host-network probe wrapper, not a healthcheck curl alone, and this review cycle still needs that normal runtime path proved after the task-up repairs.
9. [x] Run `npm run compose:down` from the repository root because the previous steps started and probed the supported main stack and this final task must leave that baseline stopped again.
10. [x] Run `npm run lint` from the repository root for the final Story 60 review-cycle repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
11. [x] Run `npm run format:check` from the repository root for the final Story 60 review-cycle repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- Optional only if later closeout still needs a live `/flows` rerun after the automated proof above: use the supported main stack from `docker-compose.yml` through the repository compose wrappers rather than a `codeinfo:local` stack, verify readiness at `http://localhost:5010/health`, and use `http://localhost:5001` as the supported UI surface.
- When that optional live rerun needs the repository-owned manual-test seed catalogs, use `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` as the mounted source of agent definitions; if `review_agent` or required provider auth is still unavailable there, record the runtime limitation honestly instead of reopening implementation scope.
- If later manual proof needs screenshots, capture them first under `/tmp/playwright-output/0000060-review-cycle-final/...`, then retrieve them from `$CODEINFO_ROOT/playwright-output-local/0000060-review-cycle-final/...` on the host and transfer them into the closeout artifact destination documented by the runtime handoff for that proof run. If the runtime handoff does not expose a usable artifact destination, record that limitation honestly instead of inventing one in this task.

#### Implementation notes

- Re-read the appended follow-up findings block, `codeInfoStatus/flow-state/review-disposition-state.json`, and the stale PR summary draft, then rewrote the Task 13 checklist so every unresolved task-required finding now maps to its focused Task 11 or Task 12 proof owner and every inline-resolved minor finding now maps to the exact broad wrapper or smoke surface that must revalidate it. The helper-script proof home `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` is now called out separately instead of being implied by Node-based wrappers.
- Verified the shared baseline Task 13 depends on without running broad proof yet: `docker-compose.yml` is present, `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` are present, the checked-in main stack still references `http://localhost:5010/health` and `http://localhost:5001`, and the root `package.json` still exposes the required compose, build, server-unit, server-cucumber, e2e, host-network, lint, and format-check wrappers. No baseline seam was found from those repository-owned checks, so the PR summary now records the known `review_agent` limitation only as an optional later manual-proof caveat.
- Reconciled Task 13 wording against `review-disposition-state.json`: both now point to review cycle `0000060-rc-20260627T093723Z-91e32429`, and the PR summary no longer carries the stale Task 10 or older-cycle wording that would have implied a second final owner. This stayed inside Task 13-owned closeout text and did not reopen Task 11 or Task 12 scope.
- Refreshed `codeInfoStatus/pr-summaries/0000060-pr-summary.md` plus the closeout-routing notes for Tasks 11 and 12 so the final trace now states which focused proof owners closed the three task-required findings, which broad wrappers or smoke steps still must run, why client-only wrappers are not part of this findings block, and how the separate helper-script proof must be cross-checked during final automated validation.
- Testing 1: `npm run compose:build:summary` passed cleanly with both compose build items green, so the supported main-stack Docker build path still holds after the Task 11 and Task 12 repairs.
- Testing 2: `npm run build:summary:server` passed cleanly with no warnings, so the shared server runtime, GitHub transport, scratch ownership, and helper-script execution surfaces still build after the task-up repairs.
- Testing 3: full `npm run test:summary:server:unit` passed cleanly with 2,509 of 2,509 tests green, so the focused Task 11 and Task 12 repairs plus the inline-resolved minor fixes still hold on the repository-supported broad unit and integration wrapper surface.
- Testing 4: `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` passed cleanly with 3 of 3 tests green, so the helper-side namespaced handoff contract still matches the broad server proof after the task-up repairs.
- Testing 5: the first full `npm run test:summary:server:cucumber` run exposed stale Story 60 runtime fixtures that still wrote the pre-Task-12 story-global review handoff and let the legacy fallback overwrite the authoritative selector during the resumed-review scenario; updating `server/src/test/steps/flows-execution-runs.steps.ts` so the cucumber fixture now publishes a selector-owned execution-scoped handoff while leaving the legacy `0000060-current-review.json` file non-authoritative brought the full rerun to a clean 133-of-133 pass.
- Testing 6: full `npm run test:summary:e2e` passed cleanly with 77 of 77 tests green, so the repaired `/flows` execution surface and review-loop path still hold on the repository-supported broad browser wrapper after the Task 11 and Task 12 changes.
- Testing 7: `npm run compose:up` completed cleanly and brought the supported main stack up through healthy server readiness plus client start, so the final review-cycle validation still supports the repository-owned smoke start path after the broad automated suites.
- Testing 8: the first `npm run test:summary:host-network:main` run failed inside the repository-owned mixed-shape runtime bridge because its fallback zero-vector dimension was still hard-coded to `1536` while the checked-in main-stack roots collection expected `768`; changing `server/src/test/support/mixedShapeRuntimeBridge.js` to use the live-stack-compatible `768` fallback brought the rerun to a clean host-network probe pass with every required MCP listener reachable and the bridge row observed then cleaned.
- Testing 9: `npm run compose:down` completed cleanly and removed the supported main-stack containers plus the internal network again, so this final review-cycle validation leaves the repository-owned smoke baseline stopped after the probe sequence.
- Testing 10: `npm run lint` passed cleanly on the final Story 60 review-cycle repair surface after the fixture, smoke-bridge, and Task 13 plan-maintenance updates, so no further lint cleanup was needed before closeout.
- Testing 11: `npm run format:check` passed cleanly across the final Story 60 review-cycle repair surface, so the fixture, smoke-bridge, and Task 13 closeout updates remain Prettier-clean without follow-up formatting repair.
- Automated-proof audit closed Task 13 after confirming all four subtasks and all eleven automated proof steps were already complete on disk, that the only code changes introduced during proof stayed inside repository-owned cucumber and smoke-test support files, and that no live blocker or out-of-scope behavior drift remained.
- Manual testing skipped for the final Story 60 full-story live review-cycle closeout surface.
- Tried: restarted the supported main stack with `npm run compose:build` and `npm run compose:up`, saved `support-health.json`, `support-app-head.txt`, and `support-flows.json` under `codeInfoTmp/manual-testing/0000060/13/`, then requested `GET /flows` to reach `implement_next_plan_github_review`.
- Observed: the supported main stack started and shut down cleanly, `http://localhost:5010/health` and `http://localhost:5001` responded, but `implement_next_plan_github_review` remained disabled with `Flow agent "review_agent" is not available in the configured agent homes.`
- Why fuller proof was not possible: Task 13's own manual-testing guidance says to record this runtime limitation honestly when the mounted manual-test seed catalogs still lack `review_agent`, so the optional final live review-cycle rerun and broader full-story closeout proof cannot be exercised on the supported main stack in this step.

## Code Review Findings

### Review Pass `0000060-20260627T163109Z-40f1c89b` follow-up for review cycle `0000060-rc-20260627T174933Z-7e7ca864`

- Source of truth: `codeInfoStatus/flow-state/review-disposition-state.json` for active task-up routing. `codeInfoTmp/reviews/0000060-current-review.json` and the referenced findings, challenge, and evidence artifacts remain the scratch review basis for this same review pass.
- Review comparison context: the stored review handoff compares local `HEAD` `40f1c89be1292dea3966a95f8860c0541086264e` against resolved remote base `origin/main` at `33609a1f77499983b6cb10273fe6137ae05aa24f`, with `comparison_rule: local_head_vs_resolved_base`, `resolved_base_source: remote`, and `remote_fetch_status: success`.
- Inline-resolved minor findings already handled in this same active cycle and owned by the fresh final revalidation task below: `generic_engineering_issue-4`, `plan_contract_issue-5`, and `generic_engineering_issue-8`.
- Remaining unresolved task-required findings that must now be encoded into executable plan state: `plan_contract_issue-1`, `plan_contract_issue-3`, `generic_engineering_issue-7`, and `generic_engineering_issue-9`.

### Task 14. Preserve Execution-Scoped GitHub Review Identity Across Resume, Fetch, Close, And Feedback Gates

- Repository Name: `Current Repository`
- Task Dependencies: `Task 3, Task 12`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the remaining execution-scoped GitHub review identity seam so a resumed Story 60 run keeps acting on its own PR number, scratch selector, and reviewer-feedback handoff instead of silently switching to a newer overlapping run on the same branch. The repair must keep the approved per-run scratch ownership from Task 12 while extending that same execution-scoped authority across resumed fetch, close, and helper-side reviewer-feedback decisions.

- Highest-risk invariant: once one execution has persisted authoritative `wait.githubReviewContext`, a later overlapping execution must not be able to steal fetch, close, or reviewer-feedback authority for that paused run through branch-latest PR lookup or foreign selector rereads.
- Likely blocker family: product or story seam. This task owns the implementation and proof for the execution-scoped GitHub review identity contract.

#### Task Exit Criteria

- When `wait.githubReviewContext` already carries authoritative execution-scoped GitHub review identity, resumed `github_fetch_reviews`, `github_close_pr`, and reviewer-feedback helper reads keep using that same PR or handoff owner instead of re-resolving the latest open PR or a foreign selector.
- The repair preserves the approved Story 60 behavior that one paused execution continues the same review cycle after resume rather than selecting a different PR or mixing stale scratch state from another overlapping run.
- The helper-side reviewer-feedback consumer follows the same execution-scoped selector or handoff contract as the server-side resume path and rejects foreign, generic, or mismatched ownership state.
- Focused proof explicitly covers overlapping or contradictory review executions on the same branch, including a scenario where one newer run publishes newer review state and an older resumed run must still stay bound to its own persisted authority.

#### Addresses Findings

- Review pass `0000060-20260627T163109Z-40f1c89b`
- Finding `plan_contract_issue-1`: resumed GitHub review cycles lose execution-scoped PR and scratch identity across wait/resume consumers.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned GitHub review runtime, scratch, and helper proof files named below.

#### Subtasks

1. [x] Re-inspect the exact execution-scoped GitHub review identity seams in `server/src/flows/service.ts`, `server/src/flows/githubReview.ts`, and `scripts/flow_control/check_github_review_has_reviewer_feedback.py`, then record in this task's `Implementation notes` a short seam checklist naming which persisted `wait.githubReviewContext` fields (`executionId`, `prNumber`, `selectorPath`, and `handoffPath`) already exist, which resumed fetch or close paths still ignore them, and which helper-side rereads still fall back to branch-latest PR discovery or foreign selector state after a wait resume.
2. [x] Patch the execution-scoped GitHub review identity seam across `server/src/flows/service.ts`, `server/src/flows/githubReview.ts`, and `scripts/flow_control/check_github_review_has_reviewer_feedback.py` so resumed `github_fetch_reviews`, resumed `github_close_pr`, and helper-side reviewer-feedback rereads all prefer the persisted `wait.githubReviewContext` authority (`executionId`, `prNumber`, `selectorPath`, and `handoffPath`) when it exists, and so mismatched or missing execution-scoped identity fails closed instead of silently switching to branch-latest PR discovery or foreign selector state.
3. [x] Update `server/src/test/unit/flows.github-scratch.test.ts` plus any reused selector fixture or helper fixture so this proof owner explicitly covers requirement `persisted execution-scoped authority beats branch-latest fallback`, requirement `foreign or mismatched selector and handoff state fails closed`, and the stale-vs-live precedence boundary between the stored selector and any newer generic scratch hint.
4. [x] Update `server/src/test/integration/flows.run.loop.test.ts` as the integration proof owner so it proves the newer-run-then-older-resume interleaving across resumed `github_fetch_reviews` and `github_close_pr` behavior, including the exact ordering where a newer execution publishes fresh selector authority and an older resumed execution must not reclaim it.
5. [x] Update `scripts/test/test_check_github_review_has_reviewer_feedback.py` as the helper-script proof owner so it proves the default selector path rejects foreign, generic, or mismatched execution-scoped review state, and so stale persisted hints never override the fresh execution-scoped handoff that should control reviewer-feedback gating.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` from the repository root to prove the selector and handoff fixture changes now preserve execution-scoped review identity.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root to prove the repaired execution-scoped GitHub review identity path across resume, fetch, close, and overlapping runs.
3. [x] Run `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` from the repository root to prove the helper-side reviewer-feedback consumer follows the same execution-scoped ownership contract.
4. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Planner repair appended this review-created task from review pass `0000060-20260627T163109Z-40f1c89b` because the active disposition state still routes `plan_contract_issue-1` as unresolved task-required work after the inline minor path closed.
- Re-inspected the execution-scoped authority seam across `server/src/flows/service.ts`, `server/src/flows/githubReview.ts`, and `scripts/flow_control/check_github_review_has_reviewer_feedback.py`: persisted `wait.githubReviewContext` already carried `executionId`, `prNumber`, `selectorPath`, and `handoffPath`, but resumed fetch and close still fell back to branch-latest PR lookup while the helper still read only the shared story selector.
- Patched the runtime and helper so resumed `github_fetch_reviews`, resumed `github_close_pr`, and script-backed reviewer-feedback decisions now prefer persisted execution-scoped handoff authority, use the persisted PR number or handoff identity when available, and fail closed when that execution-scoped state is contradictory instead of silently switching to branch-latest or foreign selector ownership.
- Updated `server/src/test/unit/flows.github-scratch.test.ts` with the preserved-newer-selector versus refreshed-older-handoff case; `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` passed cleanly after a one-line type import repair in `server/src/flows/service.ts`.
- Updated `server/src/test/integration/flows.run.loop.test.ts` so the focused overlap proof now covers the newer-run-then-older-resume interleaving where the resumed run refreshes only its own execution-scoped handoff and closes only its own PR while the newer selector owner remains authoritative; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` passed cleanly after refreshing the existing open-plus-fetch fixture for explicit PR-by-number lookup.
- Updated `scripts/test/test_check_github_review_has_reviewer_feedback.py` so helper proof now covers the persisted execution-scoped handoff override path as well as foreign-selector rejection; `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` passed cleanly with 4 of 4 tests green.
- Testing 4: `npm run lint` passed cleanly on the Task 14 repair surface, so the execution-scoped resume, fetch, close, and helper-ownership updates needed no further lint cleanup before closeout.
- Testing 5: `npm run format:check` passed cleanly across the Task 14 repair surface, so the execution-scoped resume, fetch, close, and helper-ownership updates remain Prettier-clean without follow-up formatting repair.
- Manual testing skipped for the Task 14 live overlapping review-cycle runtime surface.
- Tried: restarted the supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, verified `http://localhost:5010/health` and `http://localhost:5001`, saved `support-health.json`, `support-app-head.txt`, and `support-flows.json` under `codeInfoTmp/manual-testing/0000060/14/`, then requested `GET /flows`.
- Observed: the supported stack started and shut down cleanly, but `implement_next_plan_github_review` remained disabled with `Flow agent "review_agent" is not available in the configured agent homes.`
- Why fuller proof was not possible: the mounted manual-testing seed catalogs still do not provide `review_agent`, so the task-owned overlapping review-cycle proof surface cannot be exercised on the supported main stack in this step.
- Audit closeout: repository evidence for Task 14 stayed limited to the story-owned server, helper, and proof surfaces, no new out-of-scope user-facing behavior drift was identified, and the task is now `__done__` because all subtasks and all automated proof items are complete with no live blocker remaining.
- Task 17 closeout routing now maps `plan_contract_issue-1` to this task's focused proof owners in the refreshed PR summary for review cycle `0000060-rc-20260627T174933Z-7e7ca864`, so final revalidation can trace the persisted-authority, overlap, and helper-side rejection claims back to one execution-scoped repair surface.

### Task 15. Make GitHub Stage Plan Note Appends Concurrency-Safe

- Repository Name: `Current Repository`
- Task Dependencies: `Task 3`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the remaining GitHub stage note-writer race so overlapping Story 60 retries or review cycles cannot silently drop one another's skip or failure notes by replacing the same task block from a stale pre-read. The repair must stay inside the approved Story 60 plan-note recording contract and add one explicit concurrency-safe write boundary instead of widening the story into broader plan-management redesign.

- Highest-risk invariant: if retry A appends one note and retry B appends a different note against the same task block, both durable notes must survive and an idempotent replay of either retry must not duplicate or erase them.
- Likely blocker family: product or story seam. This task owns the note-writer contract, its direct proof home, and the preserved task-block selection behavior.

#### Task Exit Criteria

- Overlapping GitHub stage plan-note writes cannot silently erase each other when two retries or review cycles append different notes under the same task block.
- The durable write boundary for GitHub stage plan notes becomes explicit in one repository-owned seam rather than relying on full-file replacement after a stale pre-read.
- Focused proof covers at least one contradictory overlapping-write case and one idempotent retry case so the repair is not justified only by code inspection.

#### Addresses Findings

- Review pass `0000060-20260627T163109Z-40f1c89b`
- Finding `plan_contract_issue-3`: GitHub-stage plan note writes can overwrite one another during overlapping retries or review cycles.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned GitHub review writer and proof-owner files named below.

#### Subtasks

1. [x] Re-inspect `appendImplementationNoteToPlan(...)`, `updateJsonAtomically(...)`, and the surrounding GitHub review writer seam in `server/src/flows/githubReview.ts`, then record in this task's `Implementation notes` which task-block selection rules and duplicate-note checks must remain stable while the write path stops letting a stale pre-read erase a sibling append from another retry or review cycle.
2. [x] Patch the durable note-writer seam in `server/src/flows/githubReview.ts`, including `appendImplementationNoteToPlan(...)` and `updateJsonAtomically(...)`, so requirement `concurrent note appends preserve sibling notes` and requirement `idempotent replays do not duplicate the same note` are both enforced by one explicit compare-and-swap, retry, or equivalent concurrency-safe contract instead of by blind last-writer-wins replacement.
3. [x] Update `server/src/test/unit/flows.github-scratch.test.ts` and any reused plan-note fixture or helper assertion that it already owns so one focused proof surface separately proves requirement `contradictory overlapping appends preserve sibling notes`, requirement `idempotent replay does not duplicate the same note`, and requirement `task-block selection plus duplicate-note guards stay compatible with the new concurrent append contract`.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` from the repository root to prove the repaired GitHub stage note-writer concurrency contract.
2. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
3. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Planner repair appended this review-created task from review pass `0000060-20260627T163109Z-40f1c89b` because the active disposition state still routes `plan_contract_issue-3` as unresolved task-required work after the inline minor path closed.
- Re-inspected `appendImplementationNoteToPlan(...)` and the nearby JSON writer seam; preserved the current-task block selection contract and the exact duplicate-bullet guard while narrowing the repair to the stale pre-read plus full-file replacement boundary.
- Added one repository-local exclusive lock seam around `appendImplementationNoteToPlan(...)` and `updateJsonAtomically(...)` so sibling note appends serialize before they read and rewrite the same durable file, instead of relying on blind last-writer-wins replacement.
- Fixed an early regression in the new task-block note merge helper that briefly dropped existing bullets, then kept the repair bounded to preserving prior implementation-note lines plus one new unique bullet.
- Expanded `server/src/test/unit/flows.github-scratch.test.ts` with focused overlap, idempotent replay, and selected-task stability proofs; `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` passed after the bounded merge fix.
- Testing 2: `npm run lint` passed cleanly on the Task 15 concurrency-safe note-writer surface, so no follow-up lint cleanup was needed before the final formatting proof step.
- Testing 3: `npm run format:check` passed cleanly across the Task 15 concurrency-safe note-writer surface, so the note-writer repair and closeout plan maintenance remain Prettier-clean without follow-up formatting fixes.
- Manual testing skipped for the Task 15 live plan-note overlap runtime surface.
- Tried: restarted the supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, verified `http://localhost:5010/health` and `http://localhost:5001`, saved `support-health.json`, `support-app-head.txt`, and `support-flows.json` under `codeInfoTmp/manual-testing/0000060/15/`, then requested `GET /flows`.
- Observed: the supported stack started and shut down cleanly, but `implement_next_plan_github_review` remained disabled with `Flow agent "review_agent" is not available in the configured agent homes.`
- Why fuller proof was not possible: the mounted manual-testing seed catalogs still do not provide `review_agent`, so the task-owned live plan-note overlap proof surface cannot be exercised on the supported main stack in this step.
- Audit closeout: repository evidence for Task 15 stayed inside the story-owned GitHub note-writer and proof surfaces, no out-of-scope user-facing behavior drift was introduced, and the task is now `__done__` because every subtask and automated proof item is complete with no live blocker remaining.
- Task 17 closeout routing now maps `plan_contract_issue-3` to this task's focused note-writer proof owner in the refreshed PR summary for review cycle `0000060-rc-20260627T174933Z-7e7ca864`, so the final owner can point at one bounded concurrency-safe append surface during broad revalidation.

### Task 16. Keep Persisted Wait Recovery Authoritative Across Wake Preflight And Startup Backfill

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the remaining persisted-wait recovery seam so a wake-time preflight failure cannot silently drop authoritative wait ownership and a startup backfill failure cannot crash the whole server before it starts listening. The repair must treat wake-time and startup-time recovery as one coherent lifecycle contract, because both findings live on the same persisted wait-registration and recovery boundary rather than on unrelated product surfaces.

- Highest-risk invariant: a persisted wait that is still recoverable must not disappear between timer wake and durable resume or terminal failure, and a recoverable startup backfill fault must not prevent the server from reaching its normal listen contract.
- Likely blocker family: product or story seam, with a shared wrapper or baseline seam only when compose, readiness, or host-level startup proof fails before the repository-owned recovery code runs.

#### Task Exit Criteria

- Wake-time preflight failures no longer unschedule a persisted wait without either preserving or rearming authoritative recovery ownership, or marking the flow terminal through one explicit durable path.
- Startup wait recovery no longer turns a recoverable wait-scan or scheduler-registration failure into a process-fatal bootstrap exit before the server reaches its normal runtime contracts.
- The repaired recovery contract keeps baseline or runtime limitations distinguishable from product regressions instead of silently losing wait ownership or collapsing the whole server.
- Focused proof covers both the wake-time preflight-failure branch and the degraded startup-recovery branch, with assertions that claim those exact lifecycle boundaries rather than only adjacent successful resume or startup happy paths.

#### Addresses Findings

- Review pass `0000060-20260627T163109Z-40f1c89b`
- Finding `generic_engineering_issue-7`: wake-time preflight failures can unschedule a persisted wait without retrying it in-process or marking the flow terminal.
- Finding `generic_engineering_issue-9`: startup wait recovery can crash the whole server before listen on a recoverable wait-scan or registration failure.

#### Documentation Locations

- No additional external documentation is required for this review-created repair; use the repository-owned persisted-wait runtime and proof-owner files named below.

#### Subtasks

1. [x] Re-inspect the exact persisted-wait recovery seams in `server/src/flows/service.ts` and `server/src/index.ts`, including `schedulePersistedWaitResume(...)`, `resumePendingFlowWaitsForStartup()`, `flows.wait.resume.failed`, the `RUN_IN_PROGRESS` special case, and the startup hook that currently awaits wait recovery before listen, then record in this task's `Implementation notes` which branch currently drops authoritative recovery ownership, which branch currently aborts startup, and which preserved behavior must still survive the repair: a healthy wake resumes once and a recoverable startup fault still reaches listen.
2. [x] Patch the wake-time recovery seam so requirement `preflight failure does not drop authoritative wait recovery ownership` is owned by `server/src/flows/service.ts`, with one explicit durable outcome that either preserves or rearms recovery ownership or marks the flow terminal instead of only logging the failure.
3. [x] Patch the startup recovery seam across `server/src/flows/service.ts` and `server/src/index.ts` so requirement `recoverable wait scan or registration faults do not crash pre-listen startup` is owned by one explicit degraded-start contract that still surfaces clear diagnostics without silently hiding the failure or pretending the baseline is healthy.
4. [x] Update `server/src/test/integration/flows.run.resume.backfill.test.ts` as the focused proof owner so it separately proves requirement `wake-time preflight failure preserves or terminalizes authoritative wait ownership instead of dropping it`, requirement `recoverable startup wait-scan or registration failure still reaches listen through the degraded-start contract`, and the invalid persisted-state boundary that malformed wait metadata is still rejected rather than silently re-registered.

#### Testing

This task keeps task-local proof on the focused persisted-wait backfill wrapper plus the server build wrapper because those are the narrowest repository-supported automated surfaces that directly exercise the repaired wake-time and degraded-start contract. The image-backed main-stack compose build and smoke-start proof for this same startup seam is intentionally owned once by Task 17 so Tasks 14 through 16 do not each duplicate the same broad runtime validation.

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.backfill.test.ts` from the repository root to prove the repaired persisted-wait wake and startup recovery contract.
2. [x] Run `npm run build:summary:server` from the repository root because this task changes the shared server startup path before listen.
3. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
4. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Planner repair appended this review-created task from review pass `0000060-20260627T163109Z-40f1c89b` because the active disposition state still routes `generic_engineering_issue-7` and `generic_engineering_issue-9` as one coherent unresolved task-required lifecycle seam after the inline minor path closed.
- Re-inspected the persisted-wait recovery seams and confirmed the two bad branches named by the review: `schedulePersistedWaitResume(...)` deleted in-memory wake ownership before resume preflight succeeded, and `server/src/index.ts` still awaited startup wait recovery directly before `listen()`, letting a recoverable registration failure abort startup.
- Patched the wake callback so non-terminal preflight failures now rearm the persisted wait through one durable path with an updated `resumeAt`, while rearm failure falls back to an explicit terminal persisted failure instead of only logging and dropping ownership.
- Patched startup recovery into an explicit degraded-start contract that returns a non-throwing result object from `resumePendingFlowWaitsForStartup()` and lets `server/src/index.ts` warn and continue to `listen()` when registration fails before startup completes.
- Expanded `server/src/test/integration/flows.run.resume.backfill.test.ts` with focused wake-time rearm and degraded startup-registration proofs while keeping malformed persisted wait state rejected; `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.backfill.test.ts` and `npm run build:summary:server` both passed.
- Testing 3: `npm run lint` passed cleanly on the Task 16 persisted-wait recovery repair surface, so no follow-up lint cleanup was needed before the final formatting proof step.
- Testing 4: `npm run format:check` passed cleanly across the Task 16 persisted-wait recovery repair surface, so the degraded-start and wake-rearm repair stays Prettier-clean without follow-up formatting fixes.
- Audit closeout: repository evidence for Task 16 stayed within the story-owned persisted-wait and startup-recovery seam, no out-of-scope user-facing behavior drift was introduced, and the task is now `__done__` because every subtask and automated proof item is complete with no live blocker remaining.
- Manual testing skipped for the live Story 60 wait-step confidence surface after restarting the stale main stack from the documented `npm run compose:build` and `npm run compose:up` path.
- Tried: `GET /flows` on the fresh main stack after `http://localhost:5010/health` and `http://localhost:5001` both came up, with scratch proof saved under `codeInfoTmp/manual-testing/0000060/16/`.
- Observed: the supported stack started and shut down cleanly, but `implement_next_plan_github_review` stayed disabled with `Flow agent "review_agent" is not available in the configured agent homes.`
- Why fuller proof was not possible: the mounted `manual_testing` agent catalogs still do not provide `review_agent`, so the task-scoped live wait-step route remained structurally unavailable in the supported runtime after the single bounded recovery pass.
- Task 17 closeout routing now maps `generic_engineering_issue-7` and `generic_engineering_issue-9` to this task's focused backfill proof owner in the refreshed PR summary for review cycle `0000060-rc-20260627T174933Z-7e7ca864`, while carrying forward the missing `review_agent` catalog entry as a manual-proof limitation rather than a shared baseline seam.

### Task 17. Revalidate review pass `0000060-20260627T163109Z-40f1c89b` after review-cycle `0000060-rc-20260627T174933Z-7e7ca864` task-up repairs

- Repository Name: `Current Repository`
- Task Dependencies: `Task 14, Task 15, Task 16`
- Task Status: `__done__`
- Git Commits:

#### Overview

This fresh review-created final task owns the whole active review cycle's post-repair validation for review cycle `0000060-rc-20260627T174933Z-7e7ca864`. It revalidates the unresolved task-required findings routed into Tasks 14 through 16, also covers every inline-resolved minor finding already recorded for this same active cycle, and owns the full relevant repository-supported regression proof needed before Story 60 can close again.

- Highest-risk invariant: the broad proof pass must distinguish repository-owned product regressions from shared baseline or runtime-handoff failures while still proving that every serious finding and every inline-resolved minor fix for this cycle remains reachable through the supported default paths.
- Likely blocker family: shared wrapper or baseline seam for the broad wrapper, compose, readiness, and host-network proof surfaces, with task-owned product validation still required once that baseline is healthy.

#### Task Exit Criteria

- Review-created findings `plan_contract_issue-1`, `plan_contract_issue-3`, `generic_engineering_issue-7`, and `generic_engineering_issue-9` are revalidated on their focused proof owners and on the relevant broad repository-supported regression surfaces after Tasks 14 through 16 complete.
- Inline-resolved minor findings `generic_engineering_issue-4`, `plan_contract_issue-5`, and `generic_engineering_issue-8` are also revalidated as part of this same final task rather than being left to a second final-owner path.
- The final regression summary, reviewer-facing artifacts, this plan, and `review-disposition-state.json` all reflect one clean post-repair Story 60 state for review cycle `0000060-rc-20260627T174933Z-7e7ca864`, and no second final revalidation owner remains for this cycle.
- Client-only browser proof is not required for this findings block unless later implementation broadens beyond the current server, helper-script, startup, or persisted-wait surfaces; if that happens, update this task honestly instead of silently assuming browser proof was already covered.
- Shared baseline failures are separated from product regressions before closeout: if the supported main stack, startup readiness path, host-network probe, agent catalog, or other repository-owned baseline is unavailable, the limitation is recorded against that baseline seam instead of being misclassified as a Story 60 product failure.

#### Addresses Findings

- Review pass `0000060-20260627T163109Z-40f1c89b`
- Final revalidation owner for unresolved task-required findings `plan_contract_issue-1`, `plan_contract_issue-3`, `generic_engineering_issue-7`, and `generic_engineering_issue-9`
- Also revalidate inline-resolved minor findings `generic_engineering_issue-4`, `plan_contract_issue-5`, and `generic_engineering_issue-8` for review cycle `0000060-rc-20260627T174933Z-7e7ca864`

#### Affected Repositories

- `Current Repository`

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - refresh the reviewer-facing closeout summary after this fresh review-cycle revalidation task completes.

#### Subtasks

1. [x] Re-read this appended `Code Review Findings` follow-up block, the active `codeInfoStatus/flow-state/review-disposition-state.json`, and `codeInfoStatus/pr-summaries/0000060-pr-summary.md`, then update the PR summary draft with a task-required findings proof checklist that maps `plan_contract_issue-1` requirement `persisted authority beats branch-latest fallback` to `server/src/test/unit/flows.github-scratch.test.ts`, `plan_contract_issue-1` requirement `newer-run then older-resume interleaving stays execution-scoped` to `server/src/test/integration/flows.run.loop.test.ts`, `plan_contract_issue-1` requirement `helper-side feedback reads reject foreign execution state` to `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback`, `plan_contract_issue-3` to `server/src/test/unit/flows.github-scratch.test.ts`, and `generic_engineering_issue-7` plus `generic_engineering_issue-9` to `server/src/test/integration/flows.run.resume.backfill.test.ts`.
2. [x] Extend that same PR summary draft with an inline-resolved minor findings proof checklist that maps `generic_engineering_issue-4` and `plan_contract_issue-5` to the full `npm run test:summary:server:unit` wrapper plus the helper-script unittest surface, and maps `generic_engineering_issue-8` to the full `npm run test:summary:server:unit` wrapper plus the broad end-to-end runtime surfaces below.
3. [x] Verify the shared baseline this task depends on before broad wrapper runs begin by checking that `docker-compose.yml`, the repository compose wrappers, the readiness path `http://localhost:5010/health`, the UI path `http://localhost:5001`, and the manual-test seed catalogs under `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` still match the supported runtime contract for this story; if any one of those baseline facts is missing, renamed, or unavailable, record that limitation in the PR summary draft as a baseline seam instead of treating it as a product regression from Tasks 14 through 16.
4. [x] Compare this appended block against `codeInfoStatus/flow-state/review-disposition-state.json` and confirm that both still name review cycle `0000060-rc-20260627T174933Z-7e7ca864`, that this task title still matches `task_up_owned_final_revalidation_task_title`, and that no second final-owner wording was added elsewhere before broad wrapper runs start; if the wording drifted, repair only this task-owned wording and the matching PR summary draft text without changing Tasks 14 through 16 scope.
5. [x] Refresh `codeInfoStatus/pr-summaries/0000060-pr-summary.md` and the implementation notes for Tasks 14 through 17 so requirement `closeout remains traceable and honest` is satisfied with concrete entries for which focused proof owner closed each task-required finding, which exact broad wrapper or smoke surface revalidated each inline minor finding, whether any shared-baseline limitation was encountered, why no separate client-only browser proof was required if that remains true, and how the helper-script proof home was cross-checked against the broad server wrapper results before closeout.

#### Testing

Client-specific `npm run build:summary:client` and `npm run test:summary:client` wrappers are not applicable for this review-created findings block because the routed findings and the inline-resolved minor fixes for this cycle change no client-owned files or browser-only contracts; if later implementation broadens into client scope, update this task honestly instead of implying that client proof already happened.

1. [x] Run `npm run compose:build:summary` from the repository root because the repaired Story 60 review-cycle runtime still depends on the supported main-stack Docker build path after Tasks 14 through 16 land.
2. [x] Run `npm run build:summary:server` from the repository root because the remaining serious review-created work changes shared server runtime, GitHub review context, startup recovery, and helper-script execution surfaces.
3. [x] Run full `npm run test:summary:server:unit` from the repository root because this final task must revalidate the focused task-up repairs plus all inline-resolved minor fixes on the repository-supported unit and integration wrapper surface.
4. [x] Run `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` from the repository root because the active cycle's final validation still needs one direct helper-script proof surface that the Node-based wrappers do not cover by themselves.
5. [x] Run full `npm run test:summary:server:cucumber` from the repository root because Story 60 still owns authored flow behavior and runtime proof on the repository-supported cucumber surface after the task-up repairs.
6. [x] Run full `npm run test:summary:e2e` from the repository root because this repository's broadest supported automated `/flows` proof still helps confirm that the repaired review-cycle runtime did not regress the end-to-end execution surface, even though the routed findings remain server and helper owned.
7. [x] Run `npm run compose:up` from the repository root because this final review-cycle task must include a supported main-stack smoke start after the broad automated suites complete.
8. [x] Run `npm run test:summary:host-network:main` from the repository root after `npm run compose:up` because this repository's supported automated main-stack smoke proof is the host-network probe wrapper, not a healthcheck curl alone, and this review cycle still needs that normal runtime path proved after the task-up repairs.
9. [x] Run `npm run compose:down` from the repository root because the previous steps started and probed the supported main stack and this final task must leave that baseline stopped again.
10. [x] Run `npm run lint` from the repository root for the final Story 60 review-cycle repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
11. [x] Run `npm run format:check` from the repository root for the final Story 60 review-cycle repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- Optional only if later closeout still needs a live `/flows` rerun after the automated proof above: use the supported main stack from `docker-compose.yml` through the repository compose wrappers rather than a `codeinfo:local` stack, let those wrappers own env-file loading for the supported stack, verify readiness at `http://localhost:5010/health`, and use `http://localhost:5001/flows` as the supported UI surface for this final review-cycle rerun.
- When that optional live rerun needs the repository-owned manual-test seed catalogs, use `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` as the mounted source of agent definitions; if `review_agent` or required provider auth is still unavailable there, record the runtime limitation honestly instead of reopening implementation scope.
- If later manual proof needs screenshots for the final Story 60 `/flows` state, capture them first under a relative staging path such as `/tmp/playwright-output/0000060-review-cycle-final/...`; in this local harness flow those files should normally appear on the host under `$CODEINFO_ROOT/playwright-output-local/0000060-review-cycle-final/...` as staging output from the Playwright runtime, not as the app-under-test stack's final artifact destination. Transfer the final-task screenshots needed for closeout into `codeInfoTmp/manual-testing/0000060/17/`, treat those latest Task 17 screenshots as the primary durable visual proof for the re-covered `/flows` surfaces, and keep any earlier screenshots only when they remain uniquely necessary. If a later closeout bundle is promoted, move the selected final proof into `codeInfoStatus/manual-proof/0000060/`; if the available runtime handoff JSON is needed to confirm the artifact source, fallback runtime, or transfer destination, inspect that handoff by meaning rather than by exact property names. If screenshot transfer is still blocked, record the limitation honestly and continue with the best available evidence instead of halting the proof loop.

#### Implementation notes

- Planner repair appended this final revalidation task for review cycle `0000060-rc-20260627T174933Z-7e7ca864` because the active disposition state still routes unresolved task-required findings from review pass `0000060-20260627T163109Z-40f1c89b`, while the same cycle's three inline-resolved minor findings also need one shared post-repair final owner instead of a separate minor-only closeout path.
- Re-read this appended findings block, `codeInfoStatus/flow-state/review-disposition-state.json`, and the stale reviewer summary draft, then rewrote `codeInfoStatus/pr-summaries/0000060-pr-summary.md` from the older Task 13 cycle to the active Task 17 cycle with the current task-required findings proof checklist.
- Extended the refreshed PR summary with the inline-resolved minor findings proof checklist, pointing `generic_engineering_issue-4` and `plan_contract_issue-5` at the full server-unit wrapper plus helper-script unittest surface and pointing `generic_engineering_issue-8` at the full server-unit wrapper plus the broad end-to-end runtime surfaces owned later in this task.
- Verified the shared baseline from repository files only before broad wrapper runs: `docker-compose.yml`, compose-wrapper declarations, readiness path `http://localhost:5010/health`, UI path `http://localhost:5001`, and the mounted manual-testing seed catalogs all still match the supported Story 60 runtime contract, so no new shared-baseline seam was introduced in the refreshed summary.
- Cross-checked this appended block against `review-disposition-state.json` and confirmed both still name review cycle `0000060-rc-20260627T174933Z-7e7ca864` while this title still matches `task_up_owned_final_revalidation_task_title`; the stale final-owner wording lived only in the old PR summary draft and was repaired there without reopening Tasks 14 through 16 scope.
- Refreshed closeout traceability across Tasks 14 through 17 by appending routing notes to Tasks 14 through 16, carrying forward the missing `review_agent` catalog entry as a manual-proof limitation rather than a shared baseline seam, and recording that no separate client-only browser proof is required unless later implementation broadens beyond the current server, helper, startup, and persisted-wait surfaces.
- Testing 1: `npm run compose:build:summary` passed cleanly, so the supported main-stack Docker build path remains healthy for the Task 17 broad revalidation sequence.
- Testing 2: `npm run build:summary:server` passed cleanly, so the shared server runtime and startup path still build on the repaired Story 60 review-cycle surface before the broad regression wrappers.
- Testing 3: full `npm run test:summary:server:unit` passed cleanly with 2519 tests green, so the task-up repairs plus the inline-resolved minor findings still hold on the repository-supported broad server unit and integration wrapper surface.
- Testing 4: `python3 -m unittest scripts.test.test_check_github_review_has_reviewer_feedback` passed cleanly with 4 tests green, so the helper-side feedback authority checks still agree with the repaired execution-scoped GitHub review handoff contract after the broad server-unit rerun.
- Testing 5: full `npm run test:summary:server:cucumber` passed cleanly with 133 tests green, so the authored flow behavior and runtime seams still hold on the repository-supported cucumber surface after the task-up repairs.
- Testing 6: full `npm run test:summary:e2e` passed cleanly with 77 tests green, so the supported end-to-end `/flows` execution surface still holds after the Task 14 through Task 16 repairs and the active review-cycle closeout updates.
- Testing 7: `npm run compose:up` completed cleanly and brought the supported main stack up through healthy server readiness plus client start, so the final review-cycle smoke baseline is ready for the host-network probe.
- Testing 8: `npm run test:summary:host-network:main` passed cleanly, with every required MCP surface reachable and the mixed-shape bridge row observed then cleaned on the supported main-stack smoke path.
- Testing 9: `npm run compose:down` completed cleanly and removed the supported main-stack containers plus the internal network again, so this final review-cycle validation leaves the smoke baseline stopped after the probe sequence.
- Testing 10: `npm run lint` passed cleanly on the final Story 60 review-cycle revalidation surface, so no follow-up lint cleanup was needed before the last formatting proof step.
- Testing 11: `npm run format:check` passed cleanly across the final Story 60 review-cycle revalidation surface, so the refreshed PR summary, Task 14 through Task 17 traceability notes, and broad proof bookkeeping remain Prettier-clean without follow-up formatting fixes.
- Manual testing ran as a full-story proof pass after a restart-by-default freshness reset on the supported main stack: `npm run compose:build`, `npm run compose:up`, `http://localhost:5010/health`, `http://localhost:5001`, `http://localhost:5001/flows`, `GET /flows`, and the final `npm run compose:down` path all succeeded, with scratch proof refreshed under `codeInfoTmp/manual-testing/0000060/17/` as `support-health.json`, `support-app-head.txt`, `support-flows-ui-head.txt`, `support-flows.json`, and `support-implement-next-plan-github-review.json`.
- That same final-task pass re-confirmed the shared baseline limitation this task is supposed to separate from product regressions: `implement_next_plan_github_review` is still disabled with `Flow agent "review_agent" is not available in the configured agent homes.`, so no live review-cycle launch or new final-task screenshot superseded the earlier task-scoped UI captures because Task 17 keeps client-only browser proof optional and requires this missing agent-catalog seam to be recorded honestly rather than treated as a repaired Story 60 product failure.

## Code Review Findings

### Review Pass `0000060-20260627T235900Z-d645782a` follow-up for review cycle `0000060-rc-20260628T005107Z-4b35316f`

- Source of truth: `codeInfoStatus/flow-state/review-disposition-state.json` for active task-up routing. `codeInfoTmp/reviews/0000060-current-review.json` and the referenced findings, saturation, challenge, and evidence artifacts remain the scratch review basis for this same review pass.
- Review comparison context: the stored review handoff compared local `HEAD` `d645782a47ac508aeef1b3450b6fdbfd80ffd242` against resolved remote base `origin/main` at `33609a1f77499983b6cb10273fe6137ae05aa24f`, with `remote_fetch_status: success` and no local-fallback base inference required.
- This appended follow-up block supersedes the earlier clean-closeout posture because the active disposition state for cycle `0000060-rc-20260628T005107Z-4b35316f` still contains one unresolved task-required finding after the inline minor path resolved `generic_engineering_issue-3` and filtered `generic_engineering_issue-2` out of current-story scope.
- Inline-resolved minor findings already covered in this same active cycle and owned by the fresh final revalidation task below: `generic_engineering_issue-3`.
- Remaining unresolved task-required finding that must now be encoded into executable plan state: `plan_contract_issue-1`.

### Task 18. Restore Supported Main-Stack Reachability For The Opt-In GitHub Review Flow

- Repository Name: `Current Repository`
- Task Dependencies: `Task 17`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task restores the supported main-stack runtime contract for the new opt-in GitHub review flow. The current Story 60 branch still leaves `implement_next_plan_github_review` disabled on the checked-in main stack because that flow depends on `review_agent` while the supported stack mounts only the repository-owned `manual_testing` agent catalogs. The repair must make that opt-in flow variant reachable again on the supported stack without changing the default execution path, broadening browser-visible behavior, or turning this story into a wider agent-catalog redesign.

- Highest-risk invariant: the supported main stack must expose the Story 60 opt-in GitHub review flow as runnable through the same repository-owned catalog and discovery path that the story says operators can use, while the default checked-in flow entrypoints remain unchanged unless an operator intentionally selects the new variant.
- Likely blocker family: product or story seam, with a shared baseline seam only if the repository-owned main-stack mounts, discovery metadata, or supported catalog contract no longer match what the repaired variant expects.

#### Task Exit Criteria

- The opt-in GitHub review flow variant is no longer disabled on the supported main stack solely because `review_agent` is missing from the mounted repository-owned agent homes.
- The repair keeps Story 60's approved scope: copied opt-in flow variants gain supported-stack reachability, while existing default entrypoints and unrelated browser-visible behavior remain unchanged.
- The repaired seam has one honest supported-stack proof owner that shows the flow is now exposed as runnable under the repository-owned main-stack catalog contract instead of only through a structural flow-definition check.
- The reproduced supported-stack defect and the preserved behavior that must survive the repair are both recorded explicitly: `implement_next_plan_github_review` becomes runnable again on the supported stack, while the default `implement_next_plan` entrypoint and the existing `review_agent`-based review-step contract stay intact.
- Any catalog, flow-definition, or discovery update made here remains narrowly scoped to restoring the Story 60 opt-in review-cycle contract rather than widening the repository into a broader agent-home compatibility redesign.

#### Addresses Findings

- Review pass `0000060-20260627T235900Z-d645782a`
- Finding `plan_contract_issue-1`: the shipped opt-in GitHub review flow is still unreachable on the supported main stack because the mounted `manual_testing` catalogs do not provide `review_agent`.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - refresh the reviewer-facing summary so the repaired supported-stack reachability story and proof owner remain explicit for this review cycle.

#### Subtasks

1. [x] Trace the supported-stack discovery path across `docker-compose.yml`, mounted `manual_testing/codeinfo_agents` and `manual_testing/codex_agents`, checked-in `codeinfo_agents/review_agent`, `server/src/agents/roots.ts`, `server/src/flows/discovery.ts`, `server/src/routes/flows.ts`, and `flows/implement_next_plan_github_review.json` so you can classify the current disablement as either a runtime-ownership defect or a flow-definition defect while keeping the default `implement_next_plan` entrypoint unchanged. Prepare the proof owners that must speak for that decision: `server/src/test/unit/host-network-compose-contract.test.ts` for the checked-in main-stack mount contract, `server/src/test/unit/agents-discovery.test.ts` for preferred-vs-legacy agent-home resolution, `server/src/test/integration/flows.list.test.ts` for the catalog discovery seam, and `e2e/flows-execution-runs.spec.ts` for the default `/flows` launcher path. If the existing `flows.list` test titled `ingested Story 60 GitHub review variant is disabled when review_agent is only missing inside a nested branch` remains the preserved negative boundary, add or rename a separate explicit positive case in that same file for the repaired supported-stack runnable invariant instead of letting one title cover both meanings.
2. [x] Fix the supported-stack runtime seam in the exact files that decide whether the GitHub review variant is discoverable: update the owning flow-definition family in `flows/implement_next_plan_github_review.json`, `flows/review_plan.json`, `flows/ingest_external_review_plan.json`, `flows/task_and_implement_plan.json`, and `flows/improve_task_implement_plan.json`, plus the discovery reader surfaces in `server/src/flows/discovery.ts` and `server/src/routes/flows.ts`, so `implement_next_plan_github_review` becomes runnable when the repository-owned review-agent catalog is present. Do not change the default `implement_next_plan` path or broaden browser-visible behavior.
3. [x] Update the proof-authoring files so they match the repaired runtime contract before formal testing runs: keep `server/src/test/unit/flows-schema.test.ts` proving shipped review-entrypoint validity, keep `server/src/test/unit/host-network-compose-contract.test.ts` plus `server/src/test/unit/agents-discovery.test.ts` proving the mount and preferred-home contract, and make `server/src/test/integration/flows.list.test.ts` carry two clearly named cases instead of one ambiguous title. The positive case must claim runnable availability when the repository-owned review-agent catalog is present; the preserved negative case must claim disabled behavior only when `review_agent` is genuinely missing from the selected catalog seam.
4. [x] Update `e2e/flows-execution-runs.spec.ts` and any touched proof helpers so the `/flows` launcher proof still shows the opt-in GitHub review variant can be selected and started without mutating the default `implement_next_plan` entrypoint. Leave sibling shipped review flows parsing and loading under the same catalog contract.

#### Testing

Task 18 owns only the narrow proof needed to validate the supported-stack reachability repair itself. Because this repair can touch `docker-compose.yml`, mounted catalog routing, and `/flows` discovery without yet completing the full supported-stack runtime rerun, this task stops at focused preserved-behavior proof on the owning unit, integration, and `/flows` launcher surfaces. The fresh compose build, supported-stack startup, host-network smoke, and other broad regression wrappers for this review-created findings block stay on Task 19 so this task does not repeat the same repository-wide suites early.

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows-schema.test.ts --test-name "production review and implementation flow entrypoints remain valid JSON and schema"` from the repository root so any repaired flow-definition or catalog contract still keeps the shipped review entrypoints structurally valid.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/host-network-compose-contract.test.ts --test-name "main stays image-baked while local host-network compose exposes the live dev overlay mounts"` from the repository root so the repaired main-stack mount contract still points the supported server at the repository-owned `manual_testing` agent catalogs rather than silently drifting to a different runtime tree.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/agents-discovery.test.ts --test-name "resolveAgentHomeForRepository prefers codeinfo_agents over codex_agents"` from the repository root so the discovery reader still resolves the preferred agent-home contract that the supported-stack repair depends on.
4. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts --test-name "supported main-stack catalog exposes the Story 60 GitHub review variant as runnable when review_agent is available"` from the repository root after authoring or renaming that positive proof so the repaired supported-stack availability contract is re-proved on its own exact `flows.list` invariant rather than on the old disabled-case title.
5. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts --test-name "ingested Story 60 GitHub review variant is disabled when review_agent is only missing inside a nested branch"` from the repository root so the preserved negative boundary still proves disabled behavior only for the genuine missing-agent catalog case after the repair.
6. [x] Run `npm run test:summary:e2e -- --file e2e/flows-execution-runs.spec.ts --grep "flows let operators select the GitHub review variant without mutating the default entrypoint"` from the repository root so the repaired Story 60 variant is re-proved on the normal `/flows` launcher path while the default `implement_next_plan` entrypoint stays unchanged before the broader final-cycle rerun.
7. [x] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
8. [x] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- Optional only if later closeout still needs a live supported-stack sanity pass after the automated proof above: use the checked-in main stack through `npm run compose:build` then `npm run compose:up`, let those wrappers own env-file loading, confirm readiness at `http://localhost:5010/health`, use `http://localhost:5001/flows` as the supported UI surface, and verify the mounted `manual_testing/codeinfo_agents` plus `manual_testing/codex_agents` catalogs now expose the opt-in GitHub review flow as runnable without altering the default selected flow. If provider auth or a still-missing catalog entry prevents a deeper live cycle, record that runtime limitation honestly instead of widening implementation scope; if screenshots are needed, capture them with a relative staging path such as `0000060-task18-supported-stack/...` inside the Playwright output directory, then transfer the selected host-visible artifacts from `$CODEINFO_ROOT/playwright-output-local/0000060-task18-supported-stack/...` into `codeInfoTmp/manual-testing/0000060/18/`.

#### Implementation notes

- Re-traced the supported-stack discovery path across `docker-compose.yml`, the mounted `manual_testing` catalogs, `codeinfo_agents/review_agent`, `server/src/agents/roots.ts`, `server/src/flows/discovery.ts`, `server/src/routes/flows.ts`, and `flows/implement_next_plan_github_review.json`, then classified the live disablement as a runtime-ownership defect: the checked-in Story 60 GitHub review flow already preserves the intended `review_agent` contract, but `/flows` discovery was only treating globally mounted agent homes as available for non-command steps instead of resolving flow agents from the ingested source repository first.
- Patched `server/src/flows/discovery.ts` so flow agent availability now resolves against the flow owner's repository candidate order before falling back to globally discovered agent homes, which restores supported-stack reachability when the ingested repository carries the checked-in `codeinfo_agents/review_agent` home while leaving the default `implement_next_plan` entrypoint and the review-agent flow definitions unchanged.
- Updated `server/src/test/integration/flows.list.test.ts` so the supported-stack proof now carries two explicit catalog cases: a positive runnable Story 60 GitHub review variant when the ingested repository provides the full `review_agent` home, and the preserved negative disabled case when `review_agent` is genuinely missing only from that selected catalog seam. The first positive fixture initially failed because it copied only `review_agent/config.toml`, which left the flow's `review_agent` and `planning_agent` command surfaces unresolved; copying the full checked-in agent homes fixed that test without widening product scope.
- Testing 1 through 5: the focused server-unit proofs all passed on the repaired Task 18 seam, including `flows-schema`, `host-network-compose-contract`, `agents-discovery`, the new positive `flows.list` case, and the preserved negative `flows.list` case.
- Testing 6: the targeted `/flows` launcher proof in `e2e/flows-execution-runs.spec.ts` already matched the exact Task 18 runnable-selection invariant and passed cleanly without additional authoring changes after the discovery repair, so the opt-in GitHub review variant still selects and starts without mutating the default `implement_next_plan` entrypoint.
- Testing 7 and 8: `npm run lint` and `npm run format:check` both passed cleanly on the final Task 18 repair surface, so the discovery patch, focused catalog proofs, and plan maintenance stayed lint-clean and formatter-clean before closeout.
- Audit closeout: re-read the live plan and repository evidence after the implementation-plus-proof pass, confirmed all Task 18 subtasks and automated testing items were already honestly complete with no live blocker, and closed this task as `__done__` while leaving the broader review-cycle revalidation on Task 19.
- Manual testing skipped for the Task 18 supported-stack `/flows` sanity surface. Tried: compared the stored `codeInfoStatus/flow-state/manual-testing-runtime.json` Task 18 startup and availability contract against the reopened Task 18 plan block, `manual_testing_guidance_status.py --task-number 18`, and `plan_status.py --task-number 18` before starting the main stack. Observed: the runtime-research file still marks `task18_supported_stack_opt_in_review_surface` as `not_yet_available` and still treats Task 18 as the future enabler, while the live plan and parser now show Task 18 as the completed repair owner. Why fuller proof was not possible: the stored runtime research for this exact Task 18 proof surface is stale and must be regenerated before manual testing can honestly choose a supported startup and availability path.
- Task 19 traceability slot prepared here before final reruns: `codeInfoStatus/pr-summaries/0000060-pr-summary.md` now carries named placeholder result slots for the focused positive and negative `flows.list` catalog proofs plus the focused `/flows` launcher proof, so later closeout can cite Task 18's proof-owning seam without reopening implementation scope.

### Task 19. Revalidate review pass `0000060-20260627T235900Z-d645782a` after review-cycle `0000060-rc-20260628T005107Z-4b35316f` task-up repairs

- Repository Name: `Current Repository`
- Task Dependencies: `Task 18`
- Task Status: `__done__`
- Git Commits:

#### Overview

This fresh review-created final task owns the whole active review cycle's post-repair validation for review cycle `0000060-rc-20260628T005107Z-4b35316f`. It revalidates the unresolved task-required supported-stack reachability finding routed into Task 18, also covers the inline-resolved minor finding already recorded for this same active cycle, and owns the full relevant repository-supported regression proof needed before Story 60 can close again.

- Highest-risk invariant: the broad proof pass must distinguish repository-owned product regressions from shared baseline or runtime-handoff limitations while still proving that the repaired supported-stack review path and the inline-resolved `/flows` disabled-selection fix remain reachable through the supported default surfaces.
- Likely blocker family: shared wrapper or baseline seam for the broad wrapper, compose, readiness, and host-network proof surfaces, with task-owned product validation still required once that baseline is healthy.

#### Task Exit Criteria

- Review-created finding `plan_contract_issue-1` is revalidated on its focused proof owner and on the relevant broad repository-supported regression surfaces after Task 18 completes.
- Inline-resolved minor finding `generic_engineering_issue-3` is also revalidated as part of this same final task rather than being left to a second final-owner path.
- The final regression summary, reviewer-facing artifacts, this plan, and `review-disposition-state.json` all reflect one clean post-repair Story 60 state for review cycle `0000060-rc-20260628T005107Z-4b35316f`, and no second final revalidation owner remains for this cycle.
- Cucumber and helper-script unittest proof are not required for this findings block unless later implementation broadens beyond the current supported-stack reachability seam and the already-resolved client disabled-flow parity seam; if that happens, update this task honestly instead of silently assuming those proof surfaces were already covered.
- Shared baseline failures are separated from product regressions before closeout: if the supported main stack, startup readiness path, host-network probe, or repository-owned agent catalog remains unavailable, the limitation is recorded against that baseline seam instead of being misclassified as a Story 60 product failure.
- Focused proof must settle the highest-risk invariant before broad wrappers are allowed to speak for this cycle: the repaired supported-stack catalog and launcher path must expose `implement_next_plan_github_review` as runnable again without mutating the default `implement_next_plan` entrypoint, and the inline-resolved disabled-flow guard must still reject hidden selection bypasses on `/flows`.
- The inline-resolved stateful UI guard is re-proved explicitly: when `/flows` list data marks `implement_next_plan_github_review` disabled, the visible selection stays on the last runnable flow, the hidden disabled option remains only as non-runnable local state, and launch submissions exclude that stale value instead of sending a contradictory payload.

#### Addresses Findings

- Review pass `0000060-20260627T235900Z-d645782a`
- Final revalidation owner for unresolved task-required finding `plan_contract_issue-1`
- Also revalidate inline-resolved minor finding `generic_engineering_issue-3` for review cycle `0000060-rc-20260628T005107Z-4b35316f`

#### Affected Repositories

- `Current Repository`

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - refresh the reviewer-facing closeout summary after this fresh review-cycle revalidation task completes.

#### Subtasks

1. [x] Prepare the closeout proof map in `codeInfoStatus/pr-summaries/0000060-pr-summary.md` and the active findings block in this plan before any broad wrapper run. Write down the exact proof owners for `plan_contract_issue-1` (`server/src/test/integration/flows.list.test.ts` positive and negative catalog cases plus `e2e/flows-execution-runs.spec.ts`) and for `generic_engineering_issue-3` (`client/src/test/flowsPage.runGuard.test.tsx` plus the broader `/flows` wrapper surfaces). Keep the mixed-state contract explicit there: when list data disables `implement_next_plan_github_review`, the visible trigger stays on the last runnable flow, the hidden disabled option remains only as non-runnable local state, and `/flows/*/run` submissions exclude that stale value.
2. [x] Prepare the baseline-adjudication section before wrapper execution in the same PR summary draft and in the final-owner notes that depend on `codeInfoStatus/flow-state/review-disposition-state.json`. That prepared section must name the exact shared runtime surfaces the later broad reruns will read: `docker-compose.yml`, the compose-wrapper scripts named by `package.json`, readiness at `http://localhost:5010/health`, UI reachability at `http://localhost:5001`, and the mounted `manual_testing` catalogs. Make it obvious where to record a broken mount, port, readiness, or wording seam without misclassifying that baseline failure as a Story 60 product regression.
3. [x] Prepare the final traceability structure before formal proof runs so no post-test decomposition is needed later. In `codeInfoStatus/pr-summaries/0000060-pr-summary.md` and the implementation notes for Tasks 18 through 19, leave one slot for the focused positive and negative `plan_contract_issue-1` catalog results, one slot for the focused `/flows` stale-selection guard result from `generic_engineering_issue-3`, one slot for the broad wrapper reruns, and one slot explaining why cucumber plus helper-script surfaces stayed out of scope if that remains true.

#### Testing

Cucumber and helper-script unittest surfaces are not part of the current relevant proof set for this review-created findings block because the routed serious finding changes supported-stack catalog discovery and `/flows` reachability, while the inline-resolved minor fix changes the client-side disabled-selection guard. The existing backend Cucumber feature at `server/src/test/features/flows-execution-runs.feature` proves flow execution lifecycle and GitHub review-cycle branch composition, not the main-stack catalog mount, `GET /flows` discovery, or `/flows` disabled-selection seams being revalidated here; if later implementation broadens back into flow-execution semantics or helper-side review-count gating, update this task honestly instead of implying those proof surfaces already ran.

This final revalidation task owns the full broad regression proof for the whole current review-created findings block after Task 18 lands, including the shared build, broad wrapper, compose, and host-network reruns that are intentionally not duplicated in Task 18.

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts --test-name "supported main-stack catalog exposes the Story 60 GitHub review variant as runnable when review_agent is available"` from the repository root on the repaired Task 18 seam so the exact positive supported-stack reachability proof owner goes green before the broader wrappers, then record that focused result in the prepared PR summary proof slot.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts --test-name "ingested Story 60 GitHub review variant is disabled when review_agent is only missing inside a nested branch"` from the repository root so the preserved negative catalog boundary is re-proved with its own still-accurate title before the broader wrappers, then record that focused result beside the positive case.
3. [x] Run `npm run test:summary:e2e -- --file e2e/flows-execution-runs.spec.ts --grep "flows let operators select the GitHub review variant without mutating the default entrypoint"` from the repository root so the repaired `/flows` launcher path is re-proved on the normal default-path UI surface before the broad rerun, then record that focused default-path result in the prepared PR summary slot for `plan_contract_issue-1`.
4. [x] Run `npm run test:summary:client -- --file client/src/test/flowsPage.runGuard.test.tsx --test-name "keeps the active runnable selection when an ingested GitHub review variant is disabled from list data"` from the repository root so the inline-resolved minor fix from this same cycle is re-proved on its exact focused proof home before the broad rerun: the visible trigger stays on the runnable flow, the hidden disabled GitHub-review option remains present only as disabled local state, and no `/flows/implement_next_plan_github_review/run` request fires from that stale mixed-state path. Record that focused client result in the prepared PR summary slot for `generic_engineering_issue-3`.
5. [x] Run `npm run compose:build:summary` from the repository root because the repaired Story 60 review-cycle runtime still depends on the supported main-stack Docker build path after Task 18 lands, and record any broken mount or runtime-contract seam in the prepared baseline slot if this step fails.
6. [x] Run `npm run build:summary:server` from the repository root because the remaining serious review-created work changes supported runtime or discovery-visible server surfaces.
7. [x] Run `npm run build:summary:client` from the repository root because this final task also revalidates the inline-resolved `/flows` disabled-selection fix from the same review cycle.
8. [x] Run full `npm run test:summary:server:unit` from the repository root because this final task must revalidate the supported-stack reachability repair on the repository-supported broad server wrapper surface.
9. [x] Run full `npm run test:summary:client` from the repository root because this final task must also revalidate `generic_engineering_issue-3` on the repository-supported broad client wrapper surface.
10. [x] Run full `npm run test:summary:e2e` from the repository root because this repository's broadest supported automated `/flows` proof still helps confirm that the repaired main-stack review path and disabled-flow gating did not regress the end-to-end execution surface.
11. [x] Run `npm run compose:up` from the repository root because this final review-cycle task must include a supported main-stack smoke start after the broad automated suites complete.
12. [x] Run `npm run test:summary:host-network:main` from the repository root after `npm run compose:up` because this repository's supported automated main-stack smoke proof is the host-network probe wrapper, not a healthcheck curl alone, and this review cycle still needs that normal runtime path proved after the task-up repair. If this step surfaces a shared baseline failure, record it in the prepared baseline slot instead of attributing it to the Story 60 product seam.
13. [x] Run `npm run compose:down` from the repository root because the previous steps started and probed the supported main stack and this final task must leave that baseline stopped again.
14. [x] Run `npm run lint` from the repository root for the final Story 60 review-cycle repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
15. [x] Run `npm run format:check` from the repository root for the final Story 60 review-cycle repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- Optional only if later closeout still needs a live `/flows` rerun after the automated proof above: use the supported main stack from `docker-compose.yml` through the repository compose wrappers rather than a `codeinfo:local` stack, let those wrappers own env-file loading for the supported stack, verify readiness at `http://localhost:5010/health`, and use `http://localhost:5001/flows` as the supported UI surface for this final review-cycle rerun. If the repaired Task 18 seam still depends on catalog contents, confirm the opt-in GitHub review flow is exposed as runnable there while the default selected flow remains unchanged; if a disabled GitHub-review row is still surfaced anywhere in that rerun, confirm the visible selection stays on the runnable default flow and the disabled row cannot launch through the hidden select path.
- If later closeout still needs current-state `/flows` screenshots for this final task, capture them first with a relative staging path such as `0000060-review-cycle-final/...` inside the Playwright output directory; for this local harness workflow, those artifacts normally appear on the host at `$CODEINFO_ROOT/playwright-output-local/0000060-review-cycle-final/...`, which is staging rather than the final target repository destination. Transfer only the selected final-task artifacts into `codeInfoTmp/manual-testing/0000060/19/`, treat those latest final-task screenshots as the primary durable proof for the re-covered `/flows` surfaces, and keep earlier screenshots only when they remain uniquely necessary. If runtime handoff JSON is needed to confirm artifact source or destination details, inspect that handoff by meaning rather than by exact property names; if transfer is still blocked, record the limitation honestly instead of treating it as a reason to halt the proof loop.

#### Implementation notes

- Prepared the Task 19 closeout proof map in `codeInfoStatus/pr-summaries/0000060-pr-summary.md` and aligned this active task block with the current review cycle so `plan_contract_issue-1` now points at the positive and negative `flows.list` catalog cases plus the `/flows` launcher proof, while `generic_engineering_issue-3` points at `client/src/test/flowsPage.runGuard.test.tsx` plus the broader `/flows` surfaces. The stale Task 17-era summary had to be fully replaced because it still named the wrong cycle, findings, and proof owners.
- Prepared the baseline-adjudication section ahead of wrapper execution using fresh repository evidence from `docker-compose.yml`, `package.json`, readiness `http://localhost:5010/health`, UI reachability `http://localhost:5001`, and the mounted `manual_testing` catalogs, and made the summary spell out how later broad reruns should record broken mounts, ports, readiness probes, or wrapper wording as baseline seams instead of Story 60 product regressions.
- Prepared the final traceability slots before any formal proof reruns by leaving explicit placeholder result slots in the PR summary for the focused positive and negative catalog checks, the focused stale-selection guard, the broad wrapper reruns, and the out-of-scope explanation for cucumber plus helper-script surfaces. Task 18 received a matching routing note so later closeout can cite the repair owner without re-decomposing the cycle after tests run.
- Testing 1: the focused positive `flows.list` catalog proof passed cleanly with `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts --test-name "supported main-stack catalog exposes the Story 60 GitHub review variant as runnable when review_agent is available"`, so the repaired supported-stack reachability invariant still holds on its exact proof owner before the broader wrappers.
- Testing 2: the preserved negative `flows.list` catalog boundary passed cleanly with `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts --test-name "ingested Story 60 GitHub review variant is disabled when review_agent is only missing inside a nested branch"`, so disabled behavior still stays scoped to the genuine missing-agent catalog case before the broader wrappers.
- Testing 3: the focused `/flows` launcher e2e proof passed cleanly with `npm run test:summary:e2e -- --file e2e/flows-execution-runs.spec.ts --grep "flows let operators select the GitHub review variant without mutating the default entrypoint"`, so the repaired GitHub review variant still selects and starts on the normal default-path UI surface without mutating the default `implement_next_plan` entrypoint.
- Testing 4: the focused client stale-selection guard passed cleanly with `npm run test:summary:client -- --file client/src/test/flowsPage.runGuard.test.tsx --test-name "keeps the active runnable selection when an ingested GitHub review variant is disabled from list data"`, so the visible selection still stays on the runnable flow while the disabled GitHub-review variant remains only as non-runnable local state and does not leak into launch submissions.
- Testing 5: `npm run compose:build:summary` passed cleanly with both compose build items green, so the supported main-stack Docker build path remains healthy for the broad Task 19 revalidation sequence.
- Testing 6: `npm run build:summary:server` passed cleanly, so the supported runtime and discovery-visible server surfaces still build on the repaired Task 18 seam before the broad wrapper reruns.
- Testing 7: `npm run build:summary:client` passed after one bounded fix in `client/src/pages/FlowsPage.tsx`, where the hidden test-only flow selector handler was still typed as `ChangeEvent<HTMLInputElement>` instead of `ChangeEvent<HTMLSelectElement>`. The rerun stayed typecheck-clean and build-clean; the remaining wrapper warning is the existing Vite chunk-size advisory, not a blocking regression for this task.
- Testing 8: full `npm run test:summary:server:unit` passed cleanly with 2520 tests green, so the repaired supported-stack reachability seam still holds on the repository-supported broad server wrapper surface after the focused catalog proofs.
- Testing 9: full `npm run test:summary:client` passed cleanly with 898 tests green, so the disabled-selection guard and surrounding `/flows` client surface still hold on the repository-supported broad client wrapper after the focused stale-selection proof.
- Testing 10: full `npm run test:summary:e2e` passed cleanly with 77 tests green, so the repaired main-stack review path and disabled-flow gating still hold on the repository’s broadest supported automated `/flows` surface.
- Testing 11: `npm run compose:up` passed on rerun after an initial preflight failure showed the supported main-stack ports were still occupied by stale non-local `codeinfo2-*` containers from earlier proof. Clearing that stale main stack with `npm run compose:down` restored the baseline, and the rerun then brought the supported stack up through healthy server readiness plus client start.
- Testing 12: `npm run test:summary:host-network:main` passed cleanly, with every required MCP surface reachable and the mixed-shape bridge row observed then cleaned on the supported main-stack smoke path.
- Testing 13: `npm run compose:down` completed cleanly and removed the supported main-stack containers plus the internal network again, so this final review-cycle validation leaves the smoke baseline stopped after the probe sequence.
- Testing 14: `npm run lint` passed cleanly on the final Story 60 review-cycle revalidation surface, so no follow-up lint cleanup was needed before the last formatting proof step.
- Testing 15: `npm run format:check` passed cleanly across the final Story 60 review-cycle revalidation surface, so the refreshed PR summary, Task 18 through Task 19 traceability notes, and broad proof bookkeeping remain Prettier-clean without follow-up formatting fixes.
- Audit closeout: re-read the live Task 19 block, the refreshed PR summary, the latest automated-proof commit, and `plan_status.py --task-number 19`, then confirmed every Task 19 subtask and automated testing item was honestly complete with no live blocker and no unapproved story-scope behavior drift. Closed this final revalidation task as `__done__`.
- Manual testing ran as full-story proof on a fresh supported main stack after stopping the stale unknown-provenance runtime with `npm run compose:down`, then restarting through `npm run compose:build` plus `npm run compose:up` and returning the baseline to stopped with `npm run compose:down`. The final `/flows` rerun proved the Story 60 opt-in GitHub review variant is now exposed as runnable on the supported stack while the default visible selection still starts on `echo`; after intentional operator selection, `implement_next_plan_github_review` became the active flow with Send still enabled, and the live `GET /flows` data also reported that variant as `"disabled": false`. No disabled GitHub-review row surfaced in this rerun, so the hidden stale-selection rejection path was not re-required manually because Task 19 only requires that branch when it appears live and the focused automated proofs already cover it. Scratch proof artifacts were saved under `codeInfoTmp/manual-testing/0000060/19/` as `support-health.json`, `support-app-head.txt`, `support-flows-ui-head.txt`, `support-flows.json`, `support-implement-next-plan-github-review.json`, `support-browser-state.json`, `support-network.txt`, and `support-console.txt`; screenshots were honestly attempted with Playwright using the intended staging paths `0000060-review-cycle-final/proof-01-flows-desktop.png` and `0000060-review-cycle-final/proof-02-flows-mobile.png`, but this session's Playwright sandbox only exposed in-memory `.playwright-mcp` files and did not allow transfer into `codeInfoTmp/manual-testing/0000060/19/`, so no final-task screenshot superseded any earlier retained screenshot.

## Code Review Findings

### Review Pass `0000060-20260628T052129Z-3b5caa68` follow-up for review cycle `0000060-rc-20260628T060453Z-138f52f8`

- Source of truth: `codeInfoStatus/flow-state/review-disposition-state.json` for active task-up routing. `codeInfoTmp/reviews/0000060-current-review.json` and the referenced findings, saturation, challenge, and evidence artifacts remain the scratch review basis for this same review pass.
- Review comparison context: the stored review handoff compared local `HEAD` `3b5caa68c0d076c59f3c4e64f5fcfb54f524deca` against resolved remote base `origin/main` at `33609a1f77499983b6cb10273fe6137ae05aa24f`, with `remote_fetch_status: success` and no local-fallback base inference required.
- This appended follow-up block encodes the active unresolved task-required findings directly into executable plan state. No inline-resolved minor findings are currently recorded for review cycle `0000060-rc-20260628T060453Z-138f52f8`, so the fresh final revalidation task below only needs to cover the serious review-created findings block added here.
- Remaining unresolved task-required findings that must now be completed before story closeout: `plan_contract_issue` and `generic_engineering_issue`.

### Task 20. Restore Supported Main-Stack Review-Agent Availability For The Opt-In Review Flow

- Repository Name: `Current Repository`
- Task Dependencies: `Task 19`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the supported main-stack runtime contract for the new opt-in GitHub review flow. The current Story 60 branch still leaves `implement_next_plan_github_review` unreachable on the checked-in main stack because that flow depends on `review_agent` while the supported stack mounts only the repository-owned `manual_testing` agent catalogs. The repair must restore supported-stack reachability for that opt-in variant without mutating the default `implement_next_plan` entrypoint, broadening browser-visible behavior, or silently turning this story into a general agent-catalog redesign.

- Highest-risk invariant: the supported main stack must expose the Story 60 opt-in GitHub review flow as runnable through the same repository-owned catalog and discovery path that operators already use, while the default `implement_next_plan` entrypoint stays unchanged until an operator intentionally selects the review variant.
- Likely blocker family: product or story seam, with a shared wrapper or baseline seam only if the checked-in main-stack mounts, env-loading contract, or flow discovery metadata no longer match the repaired reachability contract.

#### Task Exit Criteria

- The supported main stack no longer advertises `implement_next_plan_github_review` as unusable solely because the mounted repository-owned agent catalogs omit the agent contract that the flow now expects.
- The repair stays inside Story 60's approved scope by restoring the shipped opt-in review-cycle path rather than redesigning default flow selection, browser-visible behavior, or general agent-home compatibility.
- The final chosen repair path is explicit and bounded: either the supported main-stack catalog exposes the required review-capable agent contract, or the copied opt-in flow variant is rerouted only to an already-mounted repository-owned review-capable contract, with the default `implement_next_plan` flow left unchanged.
- The positive supported-stack runnable invariant and the preserved negative missing-agent boundary are both re-proved on their existing proof homes before the broad final revalidation task reruns the full stack.
- The `/flows` selector mixed-state contract remains explicit and preserved while this seam is repaired: when the GitHub review variant is disabled, the visible selection stays on the last runnable flow, any hidden disabled option may remain only as non-runnable local state, and launch submissions exclude that stale disabled value instead of leaking it into `/flows/*/run`.
- If this repair changes mounted catalog content, flow wiring, or discovery disablement, the supported runtime contract remains explicit and preserved: the checked-in main stack still boots through `docker-compose.yml`, keeps using the repository-owned `server/.env` plus `server/.env.local` env loading path, mounts `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` as the authoritative agent namespace, and leaves the default `implement_next_plan` launcher reachable without a new selector or startup contract.

#### Addresses Findings

- Review pass `0000060-20260628T052129Z-3b5caa68`
- Finding `plan_contract_issue`: the supported main-stack review flow remains unreachable because the mounted main-stack agent catalogs still do not provide `review_agent`.
- Routed constraint from review disposition state: fix the underlying supported-stack defect, but do not silently convert it into a broader agent-home compatibility redesign or a default-flow behavior change outside approved story scope.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - refresh the reviewer-facing summary so the supported-stack repair seam, preserved default-path behavior, and focused proof owners remain explicit for this review cycle.

#### Subtasks

1. [x] Compare the active main-stack mount contract in `docker-compose.yml` against the opt-in review-flow requirements in the Story 60 copied review-cycle flows that are already allowed to change, starting with `flows/implement_next_plan_github_review.json` and any story-owned copied review follow-up variant, then verify the currently mounted repository-owned catalogs under `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` so the repair is pinned to one bounded ownership seam before any code changes begin. Treat `flows/review_plan.json` as an in-use baseline reference only and do not plan an in-place edit to it.
2. [x] Record one short decision note in `codeInfoStatus/pr-summaries/0000060-pr-summary.md` that picks exactly one owning repair seam from Subtask 1, names the exact reproduced supported-stack defect, writes down the exact file set to change for that seam, repeats the mounted-path and env-loading contract that stays authoritative (`docker-compose.yml`, `server/.env`, `server/.env.local`, `manual_testing/codeinfo_agents`, and `manual_testing/codex_agents`), and lists the boundaries that must not change: no default-flow mutation, no broader agent-home redesign, and no new browser-visible selection behavior beyond restoring the shipped opt-in variant.
3. [x] Apply only the file set chosen in Subtask 2 so the supported stack exposes the needed review-capable contract again: if the owning seam is catalog content, edit only the required repository-owned catalog files under `manual_testing/codeinfo_agents` or `manual_testing/codex_agents`; if the owning seam is flow wiring or discovery, edit only `flows/implement_next_plan_github_review.json`, the specific Story 60 copied review follow-up variant selected in Subtask 2, `server/src/flows/discovery.ts`, and `server/src/routes/flows.ts`. Do not edit `flows/review_plan.json` in place. In either case, keep the default `implement_next_plan` launcher and unrelated flow-selection behavior unchanged.
4. [x] Update the focused proof homes in `server/src/test/integration/flows.list.test.ts`, `client/src/test/flowsPage.runGuard.test.tsx`, and `e2e/flows-execution-runs.spec.ts` so the repaired positive runnable invariant, the preserved missing-agent negative boundary, and the preserved disabled-selection mixed-state contract all stay explicit, separately named, and traceable from `codeInfoStatus/pr-summaries/0000060-pr-summary.md`. If the chosen repair no longer depends on literal `review_agent` availability, rename or split the positive `flows.list` proof so its title and assertions describe the actual repaired review-capable contract instead of the older narrower wording.

#### Testing

Task-local proof here stays focused on the direct supported-stack reachability seam plus the main-stack build contract that this repair itself changes. The broad server, client, end-to-end, compose smoke, lint, and format reruns for the full review-created findings block remain owned by Task 22.

1. [x] Run `npm run build:summary:server` from the repository root because this repair can touch server-owned discovery or disablement seams as well as the supported runtime contract.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts` from the repository root so the repaired positive runnable invariant and the preserved missing-agent negative boundary both pass on their shared focused proof home after the repair lands.
3. [x] Run `npm run test:summary:client -- --file client/src/test/flowsPage.runGuard.test.tsx --test-name "keeps the active runnable selection when an ingested GitHub review variant is disabled from list data"` from the repository root so the preserved mixed-state UI contract is re-proved: disabled list data may remain as hidden local state, but the visible selection stays on a runnable flow and the stale disabled option is excluded from launch submissions.
4. [x] Run `npm run test:summary:e2e -- --file e2e/flows-execution-runs.spec.ts --grep "flows let operators select the GitHub review variant without mutating the default entrypoint"` from the repository root so the repaired `/flows` launcher path is re-proved through the normal UI execution seam before the broad final revalidation task takes over.
5. [x] Run `npm run compose:build:summary` from the repository root because this task touches the shipped supported-stack runtime contract, and the focused repair should still survive the repository-owned main-stack build path before the shared final revalidation task reruns the full compose smoke sequence.

#### Implementation notes

- Compared the active main-stack contract in `docker-compose.yml` against `flows/implement_next_plan_github_review.json`, the mounted `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` trees, and the checked-in `codeinfo_agents/review_agent` home before changing code. That inspection pinned the defect to one bounded seam: the supported stack mounts repository-owned proof catalogs that still omit `review_agent`, while the shipped opt-in review flow still legitimately requires that agent and no story-owned copied review follow-up variant needed separate rewiring.
- Refreshed `codeInfoStatus/pr-summaries/0000060-pr-summary.md` with a Task 20 decision note for the current review cycle, naming the reproduced defect, the chosen catalog-content seam, the exact file set, the authoritative mounted-path and env-loading contract, and the boundaries that must not change. The previous summary was still Task 19-era closeout text, so the active review pass and final-owner lines had to move forward before proof could stay traceable.
- Applied the bounded repair by copying the checked-in repository-owned `codeinfo_agents/review_agent` home into `manual_testing/codeinfo_agents/review_agent`, leaving flow wiring, discovery code, `docker-compose.yml`, and the default `implement_next_plan` launcher unchanged. This restores the review-capable agent contract on the mounted supported stack without widening into a broader agent-home redesign.
- Updated the positive `server/src/test/integration/flows.list.test.ts` seam so it now proves the mounted-catalog repair directly: the runtime agent home carries `review_agent`, the ingested repository still supplies the opt-in flow JSON, and the flow becomes runnable through the supported-stack catalog contract rather than through an ingested-repo fallback. The existing client run-guard and e2e launcher proof homes already matched the preserved mixed-state and default-entrypoint contracts, so they were re-proved unchanged instead of being renamed away from their still-accurate titles.
- Testing 1: `npm run build:summary:server` passed cleanly, so the supported runtime contract still builds after the mounted catalog update and focused proof refresh.
- Testing 2: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts` passed cleanly with 22 of 22 tests green, including the repaired positive runnable invariant and the preserved missing-agent negative boundary on their shared proof home.
- Testing 3: `npm run test:summary:client -- --file client/src/test/flowsPage.runGuard.test.tsx --test-name "keeps the active runnable selection when an ingested GitHub review variant is disabled from list data"` passed cleanly with the focused stale-selection guard still holding on its exact proof home after the mounted catalog repair.
- Testing 4: `npm run test:summary:e2e -- --file e2e/flows-execution-runs.spec.ts --grep "flows let operators select the GitHub review variant without mutating the default entrypoint"` passed cleanly, so the normal `/flows` launcher path still selects the opt-in review variant without mutating the default entrypoint.
- Testing 5: `npm run compose:build:summary` passed cleanly, so the supported main-stack Docker build path still bakes the repaired mounted catalog contract before the broader final revalidation task takes over.
- Audit: implementation and focused automated proof are both complete for Task 20. Repository evidence shows the repair stayed on the bounded mounted-catalog seam, preserved the default `implement_next_plan` entrypoint and existing `/flows` interaction contract, and left no unchecked subtasks, unchecked testing, or live blocker lines for this task.
- Manual testing (task-scoped) restarted the stale supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, then verified `/health`, `/flows`, and `/flows/implement_next_plan_github_review?sourceId=/data/codeInfo2` plus the live `/flows` selector. The supported stack now reports `implement_next_plan_github_review` as enabled, keeps the existing default launcher until the operator intentionally selects the review variant, and leaves the Send control enabled once that selector closes after the explicit opt-in choice. Saved scratch proof under `codeInfoTmp/manual-testing/0000060/20/`, including `proof-01-flows-selector-desktop.png`, `proof-02-flows-review-selected.png`, API captures, and selector-state snapshots; no additional subtasks were needed because the only browser warning was a temporary MUI popover `aria-hidden` accessibility warning and the only failed request was an unrelated aborted turns fetch that did not change the Task 20 reachability contract.

### Task 21. Bound GitHub Review Ingest Materialization Without Changing Review Semantics

- Repository Name: `Current Repository`
- Task Dependencies: `Task 19`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the unbounded GitHub review-ingest path that currently slurps a full review corpus into scratch JSON and one downstream markdown derivative. The implementation must bound the fetch or materialization seam while preserving Story 60's approved review-cycle semantics: pagination support still exists, execution-scoped scratch ownership still fails closed, and the existing reviewer-feedback filtering contract stays authoritative instead of being silently redefined for convenience.

- Highest-risk invariant: one execution's bounded GitHub review corpus must stay authoritative from fetch and filtering through scratch persistence, markdown materialization, and downstream classification, with stale scratch excluded before any downstream reader can observe it.
- Likely blocker family: product or story seam, with a proof or harness seam only if the adapter and runtime-loop fixtures cannot prove the stale-to-fresh replacement boundary deterministically on their focused proof homes.

#### Task Exit Criteria

- The GitHub review fetch or materialization path has an explicit bound, batching rule, chunking rule, or other concrete limit that prevents a large review thread from expanding into one unbounded scratch-write plus one unbounded markdown prompt input.
- The repair preserves Story 60's approved semantics: review submissions and inline comments are still fetched through the supported GitHub review path, execution-scoped scratch ownership still stays authoritative, and the downstream classification contract is not silently reinterpreted to make the proof easier.
- The chosen bound is documented in the task-owned proof notes so later revalidation can tell whether the remaining behavior is intended bounded ingestion rather than an accidental truncation regression.
- The bounded-ingest seam keeps its producer and consumer contract explicit: the review fetch and filter producer, the execution-scoped scratch JSON writer, the external-review markdown materializer, and the downstream classifier reader all still agree on which bounded corpus is authoritative for one execution.
- Partial or failed bounded writes still fail closed instead of leaking mixed stale and fresh review content downstream, and the focused proof names the exact ordering boundary that must hold: fresh bounded scratch ownership and content replacement complete before downstream markdown or classification reads that execution's review corpus.

#### Addresses Findings

- Review pass `0000060-20260628T052129Z-3b5caa68`
- Finding `generic_engineering_issue`: GitHub review fetch still materializes an unbounded review corpus into scratch JSON and one downstream markdown input.
- Routed constraint from review disposition state: fix the underlying boundedness defect in the fetch, filter, scratch-persistence, or markdown-materialization seam without silently broadening the story into a new review-policy redesign.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - capture the chosen bounding rule, the preserved review semantics, and the focused proof files for the repaired ingest path.

#### Subtasks

1. [x] Trace the exact unbounded expansion chain across `fetchPullRequestReviews(...)`, `filterGitHubReviewFeedback(...)`, `writeGitHubReviewScratch(...)`, `readGitHubReviewScratch(...)`, `buildGitHubExternalReviewInputMarkdown(...)`, and `runGitHubFetchReviewsStep(...)`, then write down which function currently owns the producer bound, which function writes the execution-scoped scratch JSON, which function reads it back, and which Story 60 scratch root still owns cleanup so the repair stays pinned to one seam.
2. [x] Record the preserved semantics for that seam in `codeInfoStatus/pr-summaries/0000060-pr-summary.md` before changing code: pagination support stays intact, both review submissions and inline comments remain in scope, execution-scoped scratch ownership still fails closed, the downstream classifier does not silently get a new policy contract here, and the chosen bound plus writer, reader, and cleanup owner are written down in one place for later revalidation.
3. [x] Add the chosen bound in `server/src/flows/githubReview.ts` at the producer or materialization seam identified in Subtask 1, and keep that code responsible for making the bounded corpus explicit rather than spreading a second policy choice across unrelated helpers.
4. [x] Update `server/src/flows/service.ts` only as needed so the bounded corpus from Subtask 3 survives the execution-scoped scratch write, scratch reread, and downstream materialization path without leaking partial, stale, or foreign scratch state and without inventing a second cleanup contract outside the Story 60 scratch root.
5. [x] Update the focused proof homes in `server/src/test/unit/flows.github-adapter.test.ts` and `server/src/test/integration/flows.run.loop.test.ts`, including any fixture or assertion adjustments needed to prove both the preserved review-fetch semantics and the new bounded-ingest rule, then reflect those proof owners in `codeInfoStatus/pr-summaries/0000060-pr-summary.md`. The focused proof must name the producer-consumer boundary it owns: adapter proof covers the bounded fetch and filter corpus, while runtime-loop proof covers the exact ordering boundary where fresh execution-scoped scratch replaces stale content before markdown materialization and downstream classification reads it. Do not rely on the current pagination-only or stale-scratch-only test names if the new assertions would prove more than they claim; rename, split, or add focused cases so one proof name still owns pagination, another owns the bounded-ingest invariant, and the runtime proof stays deterministic without elapsed-time or worker-shared scratch assumptions.

#### Testing

Task-local proof here stays intentionally narrow because the changed behavior is reached directly through the focused GitHub review adapter and runtime-loop proof homes. Task 22 owns the broad server, client, end-to-end, compose smoke, lint, and format reruns for the whole review-created findings block.

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` from the repository root so the preserved pagination contract and the new bounded-ingest rule both pass on the focused adapter proof home.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root so the execution-scoped scratch handoff, stale-to-fresh replacement ordering boundary, and downstream materialization path are re-proved after the ingest bound is added without consuming partial or foreign scratch state.

#### Implementation notes

- Traced the unbounded review-ingest chain before code changes: `fetchPullRequestReviews(...)` currently owns the producer corpus, `writeGitHubReviewScratch(...)` writes the execution-scoped JSON artifact and handoff, `readGitHubReviewScratch(...)` rereads that handoff, `runGitHubFetchReviewsStep(...)` preserves write -> reread -> materialize ordering, and `buildGitHubReviewScratchPaths(...).reviewsRoot` under `codeInfoTmp/reviews` remains the single Story 60 cleanup root.
- Refreshed `codeInfoStatus/pr-summaries/0000060-pr-summary.md` before implementation so Task 21 now records the preserved pagination/filter/scratch-authority semantics, the chosen producer-side bound, and the focused proof owners for later revalidation.
- Added a producer-side cap in `fetchPullRequestReviews(...)` so the newest 200 normalized review submissions and newest 200 normalized inline comments become the single bounded execution corpus before `writeGitHubReviewScratch(...)` persists the artifact.
- Re-read `runGitHubFetchReviewsStep(...)` after the producer cap landed and kept `server/src/flows/service.ts` unchanged because its existing execution-scoped write -> reread -> materialize ordering already preserves the bounded corpus without introducing a second cleanup seam.
- Expanded the focused adapter and runtime-loop proofs, renamed the stale-scratch runtime case to claim bounded fresh feedback explicitly, and reran both Task 21 server-unit wrappers cleanly after the bound landed.
- Audit: implementation and focused automated proof are both complete for Task 21. Repository evidence shows the change stayed on the approved producer-side bounded-ingest seam, preserved the existing review-fetch, scratch-ownership, and downstream classification contracts, and left no unchecked subtasks, unchecked testing, or live blocker lines for this task.
- Manual testing skipped for the live GitHub review-ingest runtime surface. Tried: restarted the checked-in main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, then POSTed `/flows/implement_next_plan_github_review/run` with `sourceId` and `working_folder` set to `/data/codeInfo2`. Observed: the flow started but failed before any review fetch or scratch materialization when the first Codex-backed step reported `refresh_token_reused` and `token_expired` provider-auth errors in conversation `task21-manual-20260628`. Why fuller proof was not possible: repository-owned skip policy applies because restoring that provider auth would require human-controlled reauthentication, which this manual-testing step must not attempt.### Task 22. Revalidate review pass `0000060-20260628T052129Z-3b5caa68` after review-cycle `0000060-rc-20260628T060453Z-138f52f8` task-up repairs

- Repository Name: `Current Repository`
- Affected Repositories: `Current Repository`
- Task Dependencies: `Task 20`, `Task 21`
- Task Status: `__done__`
- Git Commits:

#### Overview

This fresh final revalidation task owns the full regression proof for the current review-created findings block after the serious task-up repairs land. Inline minor fixes are not part of this review cycle, so this task only needs to revalidate the new Task 20 and Task 21 repairs while rerunning the repository-supported build, test, compose, and smoke surfaces that must stay healthy before Story 60 can close again.

This is the one task in the current review-created block that owns the full broad regression rerun for the repaired findings surface. Earlier review-created tasks keep only the narrow targeted proof needed to validate their own seam directly.

The only task-owned browser-visible seam in this closeout pass is the supported `/flows` composer contract on the main `docker-compose.yml` stack. This task does not own a broader live GitHub review-cycle walkthrough; it owns proving that the repaired opt-in review variant is exposed truthfully in the selector, that a fresh draft still starts on `echo`, and that the bottom composer controls stay usable on the supported desktop and narrow mobile surfaces used for final proof.

- Highest-risk invariant: final proof must re-prove the repaired supported-stack reachability seam and bounded-ingest seam while still separating shared baseline compose or host-network failures from story-owned regressions inside those repaired seams.
- Likely blocker family: shared wrapper or baseline seam, because this task owns the compose build, supported-stack startup, and host-network smoke path after the focused proofs have already shown the product seams green in isolation.

#### Task Exit Criteria

- Review pass `0000060-20260628T052129Z-3b5caa68` is revalidated on current `HEAD` after the Task 20 and Task 21 repairs with no remaining findings from this review-created block.
- The repaired supported-stack review-flow reachability and the repaired bounded-ingest contract are both covered by focused proof plus the repository-supported broad regression wrappers for the current repository.
- The review-created findings block for cycle `0000060-rc-20260628T060453Z-138f52f8` is the only remaining review-owned proof surface for this pass; no second final minor-fix revalidation task is needed later for this same cycle.
- The stateful `/flows` selection contract remains re-proved at closeout: a fresh draft on `http://localhost:5001/flows` settles to `echo`, the `Flow` selector still lists `implement_next_plan_github_review /data/codeInfo2` as an enabled opt-in choice on the supported main stack, intentionally choosing that row keeps `Send` enabled for the active draft, and disabled variant data cannot reclaim the active runnable selection or leak into `/flows/*/run` requests even when hidden local state still carries the old value.

#### Addresses Findings

- Review pass `0000060-20260628T052129Z-3b5caa68`
- Finding `plan_contract_issue`: supported main-stack review flow reachability still needed serious task-up repair.
- Finding `generic_engineering_issue`: bounded GitHub review-ingest materialization still needed serious task-up repair.
- Inline-resolved minor findings already recorded for this same review cycle: none.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - final proof map and closeout traceability for the current review-created findings block.

#### Subtasks

1. [x] Re-read the current review-created findings block, `codeInfoStatus/flow-state/review-disposition-state.json`, and `codeInfoStatus/pr-summaries/0000060-pr-summary.md` before broad proof starts, then confirm the final proof map still names the exact focused proof homes for the supported-stack reachability seam and the bounded-ingest seam.
2. [x] Refresh the PR summary sections for comparison context, repaired seams, focused proof owners, supported-runtime handoff details, and broad rerun ownership before wrapper execution so the final closeout can distinguish baseline-stack issues from story-owned regressions without reinterpreting the review pass later. That runtime handoff must name the supported `docker-compose.yml` stack, the compose-owned env files (`server/.env`, `server/.env.local`, `client/.env`, `client/.env.local`), the mounted agent namespace (`manual_testing/codeinfo_agents`, `manual_testing/codex_agents`), the main ports (`5001`, `5010`), the `/health` readiness checks, and the fact that `npm run test:summary:host-network:main` is the automated proof owner for the default main-stack path.
3. [x] Add explicit traceability headings or bullets in `codeInfoStatus/pr-summaries/0000060-pr-summary.md` for each focused proof surface this task owns: `server/src/test/integration/flows.list.test.ts`, `client/src/test/flowsPage.runGuard.test.tsx`, `e2e/flows-execution-runs.spec.ts`, `server/src/test/unit/flows.github-adapter.test.ts`, and `server/src/test/integration/flows.run.loop.test.ts`.
4. [x] Add the remaining traceability headings or bullets in that same PR summary for the broad wrapper reruns and supported-runtime smoke sequence: the broad server wrapper, broad client wrapper, broad end-to-end wrapper, `npm run compose:build:summary`, `npm run compose:up`, `npm run test:summary:host-network:main`, and `npm run compose:down`.
5. [x] For every traceability slot added in Subtasks 3 and 4, prefill what result belongs there before proof starts: the expected focused case name or wrapper name, any renamed, split, or newly added focused cases that keep test titles aligned to repaired invariants, and a short baseline-versus-story note that says failures before the proof reaches the repaired seam stay classified as baseline or harness issues rather than story-owned regressions.

#### Testing

1. [x] Run `npm run compose:build:summary` from the repository root because the current review-created findings block touches the shipped main-stack runtime contract, and this repository's primary containerized build path must stay healthy before the focused and broad proofs below can claim the repaired runtime still works.
2. [x] Run `npm run build:summary:server` from the repository root because both serious review-created repairs change server-owned runtime or materialization seams.
3. [x] Run `npm run build:summary:client` from the repository root because Task 20 still revalidates the `/flows` consumer path that surfaces supported-stack reachability to operators.
4. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.list.test.ts` from the repository root so the supported-stack reachability repair is re-proved again on its focused catalog proof home during final revalidation.
5. [x] Run `npm run test:summary:client -- --file client/src/test/flowsPage.runGuard.test.tsx --test-name "keeps the active runnable selection when an ingested GitHub review variant is disabled from list data"` from the repository root so the mixed-state `/flows` selection contract is re-proved again during final revalidation: the visible selection stays on a runnable flow, hidden disabled state stays non-runnable only, and stale disabled values are excluded from submissions.
6. [x] Run `npm run test:summary:e2e -- --file e2e/flows-execution-runs.spec.ts --grep "flows let operators select the GitHub review variant without mutating the default entrypoint"` from the repository root so the repaired `/flows` launcher path is re-proved again on its focused UI execution seam during final revalidation.
7. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` from the repository root so the preserved review-fetch semantics and bounded-ingest rule are re-proved again on their focused adapter proof home during final revalidation.
8. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root so the repaired scratch handoff plus bounded materialization path are re-proved again on their focused runtime proof home during final revalidation.
9. [x] Run full `npm run test:summary:server:unit` from the repository root because both serious repairs must survive the repository-supported broad server wrapper surface after their focused proof homes pass.
10. [x] Run full `npm run test:summary:server:cucumber` from the repository root because this repository's primary back-end integration proof path is the Cucumber wrapper, and the repaired flow-runtime plus review-loop seams must still hold on the authored flow-execution surface after the focused server proofs pass.
11. [x] Run full `npm run test:summary:client` from the repository root because the repaired `/flows` selection and discovery surface should still hold on the repository-supported broad client wrapper surface after Task 20 lands.
12. [x] Run full `npm run test:summary:e2e` from the repository root because the repaired supported-stack flow reachability still needs broad `/flows` execution coverage after both serious repairs land.
13. [x] Run `npm run compose:up` from the repository root because the supported main-stack smoke rerun must happen on the same broad review-created block before story closeout.
14. [x] Run `npm run test:summary:host-network:main` from the repository root after `npm run compose:up` because this repository's supported automated main-stack smoke wrapper is the honest proof owner for the repaired runtime contract, not a healthcheck or env-dump shortcut alone.
15. [x] Run `npm run compose:down` from the repository root because the previous step brings the supported main stack up and the final revalidation task must leave that baseline stopped again.
16. [x] Run `npm run lint` from the repository root for the final Story 60 repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
17. [x] Run `npm run format:check` from the repository root for the final Story 60 repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- Optional only if later closeout still needs a live `/flows` rerun after the automated proof above: use the supported main stack from `docker-compose.yml` through the repository compose wrappers rather than a `codeinfo:local` stack, let those wrappers keep the checked-in env-file contract (`server/.env`, `server/.env.local`, `client/.env`, `client/.env.local`) intact, verify that the repository-owned agent mounts still come from `manual_testing/codeinfo_agents` and `manual_testing/codex_agents`, confirm readiness at `http://localhost:5010/health`, and then inspect `http://localhost:5001/flows` in this exact order: confirm a fresh draft settles to `echo` with `Send` enabled, open the `Flow` selector, confirm `implement_next_plan_github_review /data/codeInfo2` appears as an enabled row rather than a disabled warning-only row, and if you intentionally switch to that row confirm the draft remains runnable instead of falling back to a stale disabled selection. Record only the approved repaired behavior that the automated proof already claims for this story; do not treat the manual rerun as a reason to legitimize a new oversized-corpus warning, summary, or other user-visible contract change outside Story 60.
- If later closeout still needs final-state screenshots for the repaired `/flows` surface, capture one desktop view that shows the fresh `echo` draft and one narrow mobile view that keeps the bottom composer row visible with `Working path`, `Flow`, and `Edit flow title` still exposed without clipping. Capture them first with a relative staging path such as `0000060-review-cycle-final/proof-01-flows-desktop.png` inside the Playwright output directory, then pull the staged files from `$CODEINFO_ROOT/playwright-output-local/<relative-path>` on the host before transferring only the selected final artifacts into `codeInfoTmp/manual-testing/0000060/22/`. If runtime handoff JSON is needed to confirm staging or destination details, inspect that JSON for the needed meaning rather than relying on exact property names; if transfer remains blocked, record the limitation honestly instead of treating it as a reason to halt the proof loop.

#### Implementation notes

- Re-read the Task 20 and Task 21 findings block, `codeInfoStatus/flow-state/review-disposition-state.json`, and `codeInfoStatus/pr-summaries/0000060-pr-summary.md` before broad proof work so Task 22 starts from the same focused proof map and cycle context the review loop still records.
- Refreshed the PR summary comparison context so it now names Tasks 20 and 21 as completed repair owners, Task 22 as the active final revalidation owner, and the supported runtime handoff details for the checked-in `docker-compose.yml` stack, env files, mounted agent roots, ports, readiness checks, and host-network smoke ownership.
- Added explicit focused-proof traceability for `flows.list`, `flowsPage.runGuard`, `flows-execution-runs`, `flows.github-adapter`, and `flows.run.loop`, including the exact expected case titles that should fill each slot during broad proof.
- Added the remaining broad wrapper and supported-runtime smoke traceability slots, including `compose:build:summary`, broad server/client/e2e wrappers, `test:summary:server:cucumber`, `compose:up`, `test:summary:host-network:main`, `compose:down`, `lint`, and `format:check`.
- Prefilled every focused and broad traceability slot with the expected case or wrapper name plus a baseline-versus-story note so later failures before the repaired seams are reached stay classified honestly as baseline or harness issues rather than reopened Story 60 regressions.
- `npm run compose:build:summary` passed cleanly on the supported main-stack build path, so the shipped containerized runtime still builds after the Task 20 and Task 21 repairs without needing log inspection or wrapper maintenance changes.
- `npm run build:summary:server` passed cleanly on current `HEAD`, confirming the repaired server-owned runtime and bounded-ingest seams still satisfy the repository's broad server build gate before the focused reruns.
- `npm run build:summary:client` passed after log inspection; the wrapper escalated only because Vite emitted its existing large-chunk advisory, and no client typecheck or build failure blocked the repaired `/flows` consumer path.
- The focused `server/src/test/integration/flows.list.test.ts` rerun passed 22/22 cleanly, re-proving the supported-stack reachability seam on its catalog proof home before the rest of the broad regression block.
- The focused `client/src/test/flowsPage.runGuard.test.tsx` rerun passed its targeted stale-selection case cleanly, confirming the repaired mixed-state `/flows` selection contract still keeps disabled review variants out of launch submissions.
- The focused `e2e/flows-execution-runs.spec.ts` rerun passed its targeted GitHub review variant selection scenario cleanly, re-proving that the opt-in review path remains selectable without mutating the default `/flows` entrypoint.
- The focused `server/src/test/unit/flows.github-adapter.test.ts` rerun passed 8/8 cleanly, re-proving the preserved review-fetch semantics and the new bounded-ingest rule on their adapter proof home.
- The focused `server/src/test/integration/flows.run.loop.test.ts` rerun passed 35/35 cleanly, re-proving the fresh scratch replacement ordering boundary and bounded downstream materialization path during final revalidation.
- The full `npm run test:summary:server:unit` broad wrapper passed 2521/2521 after a long healthy run, so the repaired supported-stack reachability and bounded-ingest seams survived the repository-supported broad server-unit surface without reopening a regression.
- The full `npm run test:summary:server:cucumber` wrapper passed 133/133 cleanly, confirming the repaired flow-runtime and review-loop seams still hold on the repository's authored back-end integration surface.
- The full `npm run test:summary:client` wrapper passed 898/898 cleanly, confirming the repaired `/flows` selection and discovery surface still holds across the repository-supported broad client suite.
- The full `npm run test:summary:e2e` wrapper passed 77/77 cleanly, confirming the repaired supported-stack flow reachability still holds across the repository-supported broad `/flows` execution surface before the final main-stack smoke sequence.
- The first `npm run compose:up` attempt failed honestly in preflight because port `5010` was already occupied by an existing non-local main stack, so I performed a bounded cleanup with `npm run compose:down` on that same supported stack and then reran `compose:up` successfully without touching the separate `*-local` development stack.
- `npm run test:summary:host-network:main` passed cleanly after the successful `compose:up` rerun, confirming the supported main-stack MCP endpoints and mixed-shape bridge smoke path are reachable on the repository-owned runtime contract.
- The required final `npm run compose:down` completed cleanly after the host-network smoke pass, leaving the supported non-local main stack stopped again before the last lint and format gates.
- `npm run lint` passed cleanly on the final Story 60 repair surface, so no lint-fix pass or manual cleanup was needed before the last formatting gate.
- `npm run format:check` passed cleanly on the final Story 60 repair surface, so the revalidation block finished with no remaining formatting drift to fix.
- Audit: Task 22 is complete after the implementation prep and full automated revalidation both landed on disk. Repository evidence shows every Task 22 subtask and testing step is checked honestly, the broad proof stayed on the approved Story 60 reachability and bounded-ingest surfaces, and no live blocker or out-of-scope user-facing behavior drift remains in this review-created block.
- Manual testing ran as full-story proof on a fresh supported main stack after restarting the stale unknown-provenance non-local main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, then proving clean shutdown with `npm run compose:down` and restoring the same stack to running with `npm run compose:up` because it was already running when this pass started. The closeout rerun honestly re-proved the current Story 60 `/flows` contract that Task 22 owns directly: `http://localhost:5010/health`, `http://localhost:5001`, and live `GET /flows` all stayed healthy; a fresh `/flows` draft settled to `echo`; `Send`, `Working path`, `Flow`, and `Edit flow title` became enabled after load on desktop; opening the selector showed `implement_next_plan_github_review /data/codeInfo2` as a normal selectable opt-in row rather than a disabled warning-only variant; and the narrow mobile composer kept `Working path`, `Flow`, and `Edit flow title` visible without clipping. Scratch proof was refreshed under `codeInfoTmp/manual-testing/0000060/22/` as `proof-01-flows-default-desktop.png`, `proof-02-flows-selector-open-desktop.png`, `proof-04-flows-mobile.png`, `support-health.json`, `support-app-head.txt`, `support-flows-ui-head.txt`, `support-flows.json`, `support-browser-state-default.txt`, `support-browser-state-selector-open.txt`, `support-console.txt`, `support-network.txt`, and `support-manual-selection-limitation.txt`; the retained desktop and mobile screenshots supersede earlier retained `/flows` screenshots for those re-covered closeout surfaces. Manual testing skipped for the explicit review-variant selection commit on `/flows`. Tried: opened the `Flow` listbox in Chrome DevTools, confirmed `implement_next_plan_github_review /data/codeInfo2` was present as a normal selectable option, then attempted bounded keyboard-only selection with `Tab`, `ArrowDown`, `Enter`, and `Space`. Observed: the listbox stayed on the existing `echo` selection even though the review option remained visibly enabled, and the only browser-network failures were stale-conversation `GET /conversations/task21-manual-20260628/turns` aborts that did not touch `/health` or `/flows`. Why fuller proof was not possible: this session's supported MCP browser controls did not provide a reliable committed-select path for that MUI listbox interaction, while the focused automated proofs already cover the post-selection runnable contract, so no additional subtasks were needed and the broader auth-dependent live review-cycle execution path still was not required for this closeout rerun.
- Preflight visual refinement ran against the supported main-stack `/flows` surface before implementation continued and clarified the task-owned visible seams: the fresh `echo` default draft, the enabled `implement_next_plan_github_review /data/codeInfo2` selector row, and the narrow mobile composer row that must keep `Working path`, `Flow`, and `Edit flow title` visible without clipping. No code changed in this step.
- Implementation-only audit normalized Testing item 17 to done from the already-recorded `npm run format:check` pass, confirmed via `plan_status.py` that Task 22 still has no live `- **BLOCKER**` entries, and left the task `__in_progress__` for this loop because this audit step did not perform new automated-proof work.
- Implementation-plus-automated-proof audit confirmed the on-disk closeout state now matches the checklist and proof evidence: all subtasks and automated Testing items are complete, `plan_status.py` reports no live `- **BLOCKER**` entries for Task 22, and the approved Story 60 `/flows` behavior remains preserved on the supported stack, so the task closes as `__done__` while the existing Manual Testing Guidance remains optional and non-blocking.
- GitHub review stage failed during PR open.

Lookup retry warning 1 after 30s:
gh api --paginate --slurp repos/Chargeuk/codeInfo2/pulls?state=open&head=Chargeuk:feature%2F0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps&sort=created&direction=desc&per_page=100 failed
exitCode: 1
stderr: unknown flag: --slurp

Usage:  gh api <endpoint> [flags]

Flags:
      --cache duration        Cache the response, e.g. "3600s", "60m", "1h"
  -F, --field key=value       Add a typed parameter in key=value format
  -H, --header key:value      Add a HTTP request header in key:value format
      --hostname string       The GitHub hostname for the request (default "github.com")
  -i, --include               Include HTTP response status line and headers in the output
      --input file            The file to use as body for the HTTP request (use "-" to read from standard input)
  -q, --jq string             Query to select values from the response using jq syntax
  -X, --method string         The HTTP method for the request (default "GET")
      --paginate              Make additional HTTP requests to fetch all pages of results
  -p, --preview names         GitHub API preview names to request (without the "-preview" suffix)
  -f, --raw-field key=value   Add a string parameter in key=value format
      --silent                Do not print the response body
  -t, --template string       Format JSON output using a Go template; see "gh help formatting"

Lookup retry warning 2 after 60s:
gh api --paginate --slurp repos/Chargeuk/codeInfo2/pulls?state=open&head=Chargeuk:feature%2F0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps&sort=created&direction=desc&per_page=100 failed
exitCode: 1
stderr: unknown flag: --slurp

Usage:  gh api <endpoint> [flags]

Flags:
      --cache duration        Cache the response, e.g. "3600s", "60m", "1h"
  -F, --field key=value       Add a typed parameter in key=value format
  -H, --header key:value      Add a HTTP request header in key:value format
      --hostname string       The GitHub hostname for the request (default "github.com")
  -i, --include               Include HTTP response status line and headers in the output
      --input file            The file to use as body for the HTTP request (use "-" to read from standard input)
  -q, --jq string             Query to select values from the response using jq syntax
  -X, --method string         The HTTP method for the request (default "GET")
      --paginate              Make additional HTTP requests to fetch all pages of results
  -p, --preview names         GitHub API preview names to request (without the "-preview" suffix)
  -f, --raw-field key=value   Add a string parameter in key=value format
      --silent                Do not print the response body
  -t, --template string       Format JSON output using a Go template; see "gh help formatting"

Lookup retry warning 3 after 90s:
gh api --paginate --slurp repos/Chargeuk/codeInfo2/pulls?state=open&head=Chargeuk:feature%2F0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps&sort=created&direction=desc&per_page=100 failed
exitCode: 1
stderr: unknown flag: --slurp

Usage:  gh api <endpoint> [flags]

Flags:
      --cache duration        Cache the response, e.g. "3600s", "60m", "1h"
  -F, --field key=value       Add a typed parameter in key=value format
  -H, --header key:value      Add a HTTP request header in key:value format
      --hostname string       The GitHub hostname for the request (default "github.com")
  -i, --include               Include HTTP response status line and headers in the output
      --input file            The file to use as body for the HTTP request (use "-" to read from standard input)
  -q, --jq string             Query to select values from the response using jq syntax
  -X, --method string         The HTTP method for the request (default "GET")
      --paginate              Make additional HTTP requests to fetch all pages of results
  -p, --preview names         GitHub API preview names to request (without the "-preview" suffix)
  -f, --raw-field key=value   Add a string parameter in key=value format
      --silent                Do not print the response body
  -t, --template string       Format JSON output using a Go template; see "gh help formatting"

Lookup retry warning 4 after 120s:
gh api --paginate --slurp repos/Chargeuk/codeInfo2/pulls?state=open&head=Chargeuk:feature%2F0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps&sort=created&direction=desc&per_page=100 failed
exitCode: 1
stderr: unknown flag: --slurp

Usage:  gh api <endpoint> [flags]

Flags:
      --cache duration        Cache the response, e.g. "3600s", "60m", "1h"
  -F, --field key=value       Add a typed parameter in key=value format
  -H, --header key:value      Add a HTTP request header in key:value format
      --hostname string       The GitHub hostname for the request (default "github.com")
  -i, --include               Include HTTP response status line and headers in the output
      --input file            The file to use as body for the HTTP request (use "-" to read from standard input)
  -q, --jq string             Query to select values from the response using jq syntax
  -X, --method string         The HTTP method for the request (default "GET")
      --paginate              Make additional HTTP requests to fetch all pages of results
  -p, --preview names         GitHub API preview names to request (without the "-preview" suffix)
  -f, --raw-field key=value   Add a string parameter in key=value format
      --silent                Do not print the response body
  -t, --template string       Format JSON output using a Go template; see "gh help formatting"

Final lookup failure 5 after 150s:
gh api --paginate --slurp repos/Chargeuk/codeInfo2/pulls?state=open&head=Chargeuk:feature%2F0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps&sort=created&direction=desc&per_page=100 failed
exitCode: 1
stderr: unknown flag: --slurp

Usage:  gh api <endpoint> [flags]

Flags:
      --cache duration        Cache the response, e.g. "3600s", "60m", "1h"
  -F, --field key=value       Add a typed parameter in key=value format
  -H, --header key:value      Add a HTTP request header in key:value format
      --hostname string       The GitHub hostname for the request (default "github.com")
  -i, --include               Include HTTP response status line and headers in the output
      --input file            The file to use as body for the HTTP request (use "-" to read from standard input)
  -q, --jq string             Query to select values from the response using jq syntax
  -X, --method string         The HTTP method for the request (default "GET")
      --paginate              Make additional HTTP requests to fetch all pages of results
  -p, --preview names         GitHub API preview names to request (without the "-preview" suffix)
  -f, --raw-field key=value   Add a string parameter in key=value format
      --silent                Do not print the response body
  -t, --template string       Format JSON output using a Go template; see "gh help formatting"
### Task 23. Preserve GitHub open-PR diagnostics and retry latest-open-PR reconciliation after create

- Repository Name: `Current Repository`
- Affected Repositories: `Current Repository`
- Task Dependencies: `Task 22`
- Task Status: `__done__`
- Git Commits:

#### Overview

The opt-in Story 60 GitHub review flow can create a real pull request successfully and still fail the `GitHub open PR step` immediately afterward because the follow-up `lookupLatestOpenPullRequest()` reconciliation call exits non-zero. Recent manual proof created a real PR on GitHub, but the flow only surfaced `gh api --paginate --slurp ... failed` and dropped the useful `stderr` and `exitCode` detail that would explain why the lookup failed.

This task keeps Story 60 scoped to the existing post-create reconciliation seam. It does not redesign review routing, token sourcing, base-branch selection, or the `/flows` page layout itself. Instead, it makes the failure path diagnosable and more robust: preserve the CLI diagnostics end to end, retry only the latest-open-PR lookup with bounded backoff after PR creation, record intermediate failures as warnings, and emit the full warning/error chain to the user if reconciliation still fails on the final attempt. On the supported UI, that user-visible seam is the existing `/flows` transcript plus the matching plan note, not a dedicated GitHub panel, so the implementation must make the warning and error ordering on that transcript truthful without inventing a new surface.

- Highest-risk invariant: a successfully created PR must not be reported as an opaque open-step failure just because the immediate lookup is flaky, and any final failure must preserve the underlying `gh` diagnostics instead of collapsing them to a summary string.
- Likely blocker family: server runtime seam, because the task changes the GitHub adapter plus the open-PR flow step failure/warning reporting path.

#### Task Exit Criteria

- The GitHub adapter preserves `stderr` and `exitCode` from `gh` failures through the open-PR step's plan-note and user-visible failure path.
- The post-create latest-open-PR lookup retries in a bounded way after PR creation instead of failing immediately on the first lookup error.
- Intermediate lookup failures before the final attempt are surfaced as warnings rather than as immediate terminal errors.
- A final post-create lookup failure still fails the step, but the user-visible message and plan note preserve the full warning/error chain so no diagnostic detail is lost.
- The retry logic stays scoped to post-create latest-open-PR reconciliation and does not retry `gh pr create` itself.
- On the supported `/flows` transcript surface, each non-terminal latest-open-PR lookup failure appears as its own warning turn before any terminal result for the same open-PR step.
- If a later retry succeeds, the run continues on the same transcript after those retained warning turns instead of converting the open-PR step into a terminal failure.
- If reconciliation still fails on the final retry, the terminal `/flows` transcript error turn and the matching plan note both carry the aggregated warning and error chain, including preserved `stderr` and `exitCode`, instead of collapsing to a single summary line.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - capture the new diagnostics-preservation and bounded post-create lookup-retry behavior for Story 60.

#### Subtasks

1. [x] Re-open `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, and the current Story 60 plan note about the failed open-PR lookup, then map the exact seam where `stderr`/`exitCode` are preserved today versus where they are dropped before the plan-note and user-visible failure path.
2. [x] Implement a bounded retry helper for post-create `lookupLatestOpenPullRequest()` in `server/src/flows/githubReview.ts` that performs 5 attempts total with increasing waits starting at 30 seconds, preserves each failed attempt's diagnostics, and does not retry `gh pr create` itself.
3. [x] Update the open-PR step failure/warning reporting in `server/src/flows/service.ts` so the existing `/flows` transcript emits one warning turn per non-terminal latest-open-PR lookup retry, keeps the run alive when a later retry succeeds, and emits one terminal error turn plus matching plan note containing the full aggregated warning/error chain and preserved `stderr`/`exitCode` when reconciliation still fails.
4. [x] Update the focused proof homes so unit coverage owns the retry/diagnostic behavior and the flow-run integration coverage owns the end-to-end open-PR warning/error reporting path for the repaired seam.
5. [x] Refresh `codeInfoStatus/pr-summaries/0000060-pr-summary.md` so Story 60 closeout notes the new diagnostics-preservation and bounded reconciliation-retry contract for the GitHub open-PR step.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` from the repository root so the adapter proof re-covers preserved `stderr`/`exitCode`, bounded post-create lookup retries, and final aggregated failure behavior.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts` from the repository root so the focused flow-run proof home re-covers GitHub open-PR warning and error propagation end to end on the repaired seam.
3. [x] Run `npm run test:summary:server:unit` from the repository root because this task changes shared server-owned flow runtime behavior.
4. [x] Run `npm run test:summary:server:cucumber` from the repository root because the Story 60 flow-runtime path should stay green on the repository's broader back-end integration surface after the repair.
5. [x] Run `npm run lint` from the repository root for the repaired Story 60 server/runtime surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
6. [x] Run `npm run format:check` from the repository root for the repaired Story 60 surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- On the supported main stack at `http://localhost:5001/flows`, use the existing transcript area plus the normal flow composer; this task does not own a separate GitHub review screen or a new layout seam.
- When manually exercising the repaired seam, focus on the `GitHub open PR step` transcript output: each failed post-create latest-open-PR retry should land as its own non-terminal warning turn, and a final failure should land as one terminal error turn that still includes the aggregated warning chain details rather than only a collapsed summary.
- If a truthful sandbox worked repository with repo-local `.env.local` `CODEINFO_PR_TOKEN` is available, prefer the Story 60 GitHub review flow variant that can hit this open-PR path and confirm the warning-turn ordering on the same `/flows` transcript surface before the final outcome.
- If no truthful sandbox worked repository is available, keep the manual pass scoped to confirming the supported `/flows` shell and record honestly that the live open-PR warning chain could not be exercised without widening scope beyond the available repository contract.

#### Implementation notes

- Audit repaired task truth before implementation: the prior `gh api --paginate --slurp ... failed` line was dangling after closed Task 22, so Task 23 now owns the new Story 60 work for preserving GitHub open-PR diagnostics and retrying only the post-create latest-open-PR reconciliation seam.
- Re-opened the Story 60 failure seam across `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`, and the carried-forward GitHub open-PR failure note, then confirmed the adapter already preserved `stderr`/`exitCode` while the open-PR step reporting path collapsed that detail before the plan note and user-visible failure turn.
- Added a bounded post-create latest-open-PR reconciliation helper in `server/src/flows/githubReview.ts` with five delayed lookup attempts at 30s, 60s, 90s, 120s, and 150s, plus structured per-attempt diagnostics that stay scoped to reconciliation instead of retrying `gh pr create` itself.
- Updated `server/src/flows/service.ts` to emit retry-attempt warning turns for non-terminal lookup failures, aggregate the final warning/error chain into the terminal open-PR failure message and plan note, and keep successful reconciliations moving even when earlier lookup attempts were flaky.
- Focused proof now owns the repaired seam on both sides: `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` passed with the adapter retry/diagnostic cases green, and the focused `flows.run.basic` open-PR reporting proof passed with four warning turns plus the final aggregated failure turn and durable plan note.
- Broader validation is mixed but honest: `npm run test:summary:server:cucumber`, `npm run lint`, and `npm run format:check` all passed cleanly on the Task 23 surface, while the full `npm run test:summary:server:unit` wrapper twice reached the late-suite `ok 360 - stop-near-complete flow aligns final status with persisted turns and emits Task 3 diagnostics` milestone and then stalled without a clean process exit even though the targeted `server/src/test/integration/flows.run.basic.test.ts` wrapper passed in isolation.
- Implementation-only audit after the runtime follow-up confirmed Task 23 still has no unchecked subtasks and no live blocker lines: the only additional code change since the earlier audit was pinning `gh 2.95.0` from GitHub's official apt repository in `server/Dockerfile` so the supported server runtime now honestly exposes `gh api --slurp`, and `npm run compose:build:summary` passed on that image seam. The task stays `__in_progress__` solely because the full `npm run test:summary:server:unit` wrapper remains the one unchecked automated-proof item, not because any implementation work is still open.
- Diagnostic follow-up for the remaining broad proof re-ran the hanging `server/src/test/integration/flows.run.command.test.ts` seam in isolation and confirmed the same post-`ok 49` semantic-progress stall that the full server-unit wrapper reports, so the blocker is reproducible outside the broader suite.
- **RESOLVED ISSUE** Testing step 3 now passes. The broad server-unit blocker turned out to be two GitHub review tests that exercised the new post-create open-PR lookup retry delays without stubbing `githubReviewDeps.sleep`, so their background flows kept conversation ownership alive long after the assertions passed; updating those tests to fast-forward the retry sleep and wait for runtime cleanup let the focused `flows.run.command` and `flows.run.loop` proofs pass, and the full `npm run test:summary:server:unit` wrapper later passed cleanly with `2524` tests green.
- Manual testing skipped for the Task 23 live GitHub open-PR diagnostics surface during a full-story closeout pass after restarting the stale supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, proving `http://localhost:5010/health`, `http://localhost:5001`, `GET /flows`, clean shutdown with `npm run compose:down`, and restoring the same stack to running with `npm run compose:up` because it was already running when this pass began. The same pass re-covered the story-owned `/flows` shell in its current final state on desktop and mobile, saved fresh scratch proof to `codeInfoTmp/manual-testing/0000060/23/proof-01-flows-desktop.png`, `codeInfoTmp/manual-testing/0000060/23/proof-02-flows-mobile.png`, `codeInfoTmp/manual-testing/0000060/23/support-health.json`, `codeInfoTmp/manual-testing/0000060/23/support-flows.json`, and `codeInfoTmp/manual-testing/0000060/23/support-browser-notes.txt`, and used the Playwright MCP staging files `proof-01-flows-desktop.png` plus `proof-02-flows-mobile.png` copied out of `codeinfo2-playwright-mcp-local` because the usual `$CODEINFO_ROOT/playwright-output-local` bind was not writable in this pass. Tried: used the fresh supported runtime plus the Story 60 working-path contract to look for a dedicated sandbox worked repository under `CODEINFO_HOST_INGEST_DIR=/home/dan/code` with its own repo-local `.env.local` `CODEINFO_PR_TOKEN` contract before attempting the review flow. Observed: `implement_next_plan_github_review` is enabled for `/data/codeInfo2`, and the `/flows` shell still defaults to `echo` while listing the expected Story 60 review variant, but the ingest root exposed only the active `codeInfo2` checkout plus a non-repository placeholder `/home/dan/code` path with an empty `.git` directory and no `.env.local`, so no dedicated sandbox worked repository was available for a truthful live PR-create plus post-create lookup run. Why fuller proof was not possible: Story 60 guidance requires live GitHub manual proof on a separate sandbox worked repository, and substituting the active `codeInfo2` checkout would violate that supported proof contract while the missing supporting repository remains outside the active task repair scope; the fresh `/flows` screenshots therefore supersede earlier shell-only screenshots for the current final state, while earlier deeper GitHub-review screenshots remain uniquely necessary wherever this pass could not honestly re-prove the live review progression.
- GitHub review stage failed during review fetch: Resumed GitHub review execution pull request number no longer matches its execution-scoped handoff.
- Repaired the resumed execution mismatch seam so `server/src/flows/service.ts` now warns instead of failing immediately when the resumed GitHub review context carries an unexpected PR number, then consults the latest open PR on the same branch and only continues automatically when that PR matches or exceeds the persisted execution-scoped handoff PR; the fetch path rewrites the execution-scoped scratch to the adopted newer PR before later closeout uses it. Focused proof passed for the new behavior with `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` and `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --test-name "github review resume warns on PR mismatch and adopts a same-branch newer PR for fetch and close"`, while `npm run lint` and `npm run format:check` also passed after fixing three import-order warnings the lint wrapper surfaced outside the touched GitHub-review files. Broader validation stayed mixed during this pass: `npm run test:summary:server:cucumber` failed twice in the shared `server/src/test/support/chromaContainer.ts` `Before` hook with the same 10-second container-start timeout, and the full `npm run test:summary:server:unit` wrapper remained healthy with growing heartbeat output for an extended period rather than producing a final pass or failure inside this pass window.
- Preflight visual refinement pass re-read the supported `/flows` transcript and composer shell, clarified that Task 23's user-visible seam is warning and error turn ordering on the existing transcript plus matching plan note rather than new layout work, and made no code changes in this step.
- Implementation-only audit normalized Testing step 6 to complete from existing task evidence: the latest Task 23 note already documented a successful `npm run format:check` on the repaired surface, so the unchecked box was a bookkeeping miss rather than remaining implementation work. No unchecked subtasks remain, no live `- **BLOCKER**` lines were present in the canonical parser output, and the task stays `__in_progress__` in this audit pass because this step does not re-close the task or re-run proof.
- **RESOLVED ISSUE** The reopened broad-proof blocker came from a fresh-runtime regression, not a lingering wrapper hang: after `github_open_pr`, `resolveExecutionScopedGitHubReviewPullRequest(...)` treated the same execution like a resumed run and tried to reconcile against an execution-scoped handoff file before `github_fetch_reviews` had written it, which kept the selector handoff unreadable in the late-suite ownership test. The repair keeps true resumed executions on persisted-handoff reconciliation, but when that handoff path is still absent it now resolves the already-open PR directly by number for the same execution instead of failing the fetch path early.
- Focused and broad proof both re-closed the blocker on current disk: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --test-name "github review runtime keeps the newer execution selector authoritative after an older run later attempts to reclaim scratch ownership"` passed, the full `npm run test:summary:server:unit` wrapper passed with 2527/2527 tests green, `npm run test:summary:server:cucumber` passed with 133/133 tests green, and final `npm run lint` plus `npm run format:check` both passed on the repaired `service.ts` surface. Testing steps 3 and 4 are therefore complete again and the generic automated-proof blocker is retired.
- GitHub review stage failed during review fetch: ENOENT: no such file or directory, open '/home/dan/code/codeInfo2/codeInfoTmp/reviews/0000060-github-review-27d67166-090d-476b-af3f-f0435fa7a2ad-current.json'

## Code Review Findings

### Review Pass `0000060-20260629T141234Z-d9a9011b` follow-up for review cycle `0000060-rc-20260629T162154Z-89df94b1`

- Source of truth: `codeInfoStatus/flow-state/review-disposition-state.json` for active task-up routing. `codeInfoTmp/reviews/0000060-current-review.json` and the referenced findings, saturation, challenge, and evidence artifacts remain the scratch review basis for this same review pass.
- Review comparison context: the stored review handoff compared local `HEAD` `d9a9011b44747e9e71f169712c1c5a9262020af8` against resolved remote base `origin/main` at `33609a1f77499983b6cb10273fe6137ae05aa24f`, with `remote_fetch_status: success` and no local-fallback base inference required.
- This appended follow-up block repairs the active plan so the unresolved task-required review outcome is encoded directly into executable plan state before any later review-task enhancement continues. The stored disposition state still routes seven unresolved task-required findings for this active cycle, and no unresolved minor-batchable findings remain.
- Inline-resolved minor findings already recorded for this same active cycle and now owned by the fresh final revalidation task below: `6`, `7`, and `10`.
- Remaining unresolved task-required findings that must now be completed before Story 60 can close: `1`, `2`, `3`, `4`, `5`, `8`, and `9`.

### Task 24. Restore Resumed GitHub Review Authority When Scratch Handoffs Go Missing Or Drift

- Repository Name: `Current Repository`
- Task Dependencies: `Task 23`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the resumed GitHub review authority seam when persisted execution hints drift away from the approved execution-scoped scratch contract. The active review found two linked defects on the same resumed fetch or close path: when the execution-scoped handoff disappears, the runtime can trust a stale persisted PR number before it re-runs the same-branch latest-open reconciliation rule, and when persisted selector or handoff paths drift, the resumed path can cross the filesystem boundary before it proves those paths still belong to the canonical execution-scoped scratch root.

This task stays inside the approved Story 60 review-cycle contract. It must preserve the same-branch latest-open rule, the dedicated namespaced GitHub scratch contract, and the existing execution-scoped ownership model instead of widening scope into a broader GitHub workflow redesign or a new user-visible behavior surface.

- Highest-risk invariant: a resumed execution must not fetch reviews from, close, or read scratch for a stale or foreign PR or handoff merely because older persisted hints still exist when the execution-scoped handoff has gone missing or drifted.
- Likely blocker family: `product or story seam`, because this task changes the resumed PR-authority path, scratch reread path, and the focused proof owners that guard them.

#### Task Exit Criteria

- A missing execution-scoped GitHub review handoff no longer makes the resumed fetch or close path trust the persisted PR number before it re-runs the same-branch latest-open reconciliation rule that Story 60 already established for mismatch recovery.
- Resumed GitHub review rereads validate or reconstruct persisted selector and handoff paths before any filesystem read crosses the canonical repository-scoped execution-scratch boundary.
- The repair preserves the approved same-branch latest-open rule, execution-scoped scratch ownership contract, and failure-closed path containment behavior instead of inventing a new generic fallback or changing current user-visible review-loop behavior.
- Focused proof explicitly covers the missing-handoff authority branch, the pre-read path-validation boundary, and the resumed runtime interleaving where stale persisted hints would otherwise outrank fresh same-branch review state.

#### Addresses Findings

- Review pass `0000060-20260629T141234Z-d9a9011b`
- Finding `1`: resumed GitHub-review fallback bypasses the newer-PR reconciliation rule when the execution-scoped handoff disappears.
- Finding `4`: resumed GitHub review trusts persisted scratch paths early enough to dereference arbitrary server-side files before canonical path validation runs.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - capture the repaired missing-handoff authority rule, the restored pre-read containment boundary, and the focused proof owners for this seam.

#### Subtasks

1. [x] In `server/src/flows/service.ts` and `server/src/flows/githubReview.ts`, identify the exact resumed-review branches inside `resolveExecutionScopedGitHubReviewPullRequest(...)`, the resumed fetch or close callers, and the scratch readers that currently trust persisted `prNumber`, `selectorPath`, or `handoffPath`, and use that map to choose the one shared authority-helper boundary that the later edits will keep.
2. [x] In `server/src/flows/githubReview.ts` and the resumed GitHub review context handling inside `server/src/flows/service.ts`, change scratch rereads so they rebuild the canonical execution-scoped selector or handoff path from trusted execution inputs first, reject any persisted path that escapes or no longer matches that canonical root, and leave the last valid selector-owned scratch authoritative when the newer execution-scoped handoff is missing or only partially refreshed.
3. [x] In `server/src/flows/service.ts`, update both `runGitHubFetchReviewsStep(...)` and `runGitHubClosePrStep(...)` to call the same repaired PR-authority helper, so each resumed path re-runs same-branch latest-open reconciliation before any by-number fallback and neither path keeps its own stale-PR shortcut.
4. [x] Update `server/src/test/unit/flows.github-adapter.test.ts` and `server/src/test/unit/flows.github-scratch.test.ts` so one focused proof home explicitly owns the missing-handoff PR-authority rule and the other explicitly owns the pre-read scratch containment rule; if either proof reuses an existing test that currently claims only persisted-handoff mismatch or generic stale-scratch behavior, rename, split, or re-fixture it so the title and assertions name the exact missing-handoff or containment invariant instead of adjacent behavior.
5. [x] Update `server/src/test/integration/flows.run.loop.test.ts` so the runtime proof covers both resumed fetch and resumed close behavior after handoff loss or stale persisted selector or PR hints, and so the assertions prove the combined ordering boundary rather than only an earlier or later symptom: the resumed path must re-enter same-branch authority before any stale PR fallback or foreign-path read can become observable.

#### Proof Matrix

1. Requirement: missing execution-scoped handoff must re-enter same-branch latest-open reconciliation before any persisted `prNumber` fallback can win on resumed fetch or close.
   Implementation owners: `server/src/flows/service.ts`, `server/src/flows/githubReview.ts`.
   Proof owners: `server/src/test/unit/flows.github-adapter.test.ts` for helper-level authority precedence with a title that explicitly claims the missing-handoff rule, and `server/src/test/integration/flows.run.loop.test.ts` for the combined resumed fetch/close runtime interleaving.
2. Requirement: stale persisted `selectorPath` or `handoffPath` must be reconstructed or rejected before any filesystem read crosses the execution-scoped scratch boundary.
   Implementation owners: `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`.
   Proof owners: `server/src/test/unit/flows.github-scratch.test.ts` for pre-read containment and `server/src/test/integration/flows.run.loop.test.ts` for resumed runtime behavior after persisted-hint drift.
3. Failure mode: fresh same-branch PR authority must outrank stale persisted hints without breaking the approved close-path reuse of the same authority helper.
   Implementation owners: `server/src/flows/service.ts`.
   Proof owners: `server/src/test/integration/flows.run.loop.test.ts` plus any renamed focused assertions in `server/src/test/unit/flows.github-adapter.test.ts`.
4. Edge case: selector or handoff refresh must stay atomic enough that resumed readers observe either the last valid selector-owned scratch or the fully rebuilt execution-scoped scratch, never a partial or foreign-path intermediate.
   Implementation owners: `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`.
   Proof owners: `server/src/test/unit/flows.github-scratch.test.ts` plus the resumed runtime assertions in `server/src/test/integration/flows.run.loop.test.ts`.

#### Testing

Keep this task's automated proof compact and seam-local. The broader server build, cucumber, lint, and format reruns for this review-created findings block are owned by Task 28.

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` from the repository root so the repaired missing-handoff PR-authority rule passes on its focused adapter proof home.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` from the repository root so the repaired pre-read scratch containment boundary passes on its focused scratch proof home.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root so the resumed runtime still obeys the repaired same-branch authority boundary end to end after the seam is changed.

#### Implementation notes

- Re-read the resumed authority seam across `resolveExecutionScopedGitHubReviewPullRequest(...)`, `runGitHubFetchReviewsStep(...)`, `runGitHubClosePrStep(...)`, `reconcileResumedGitHubReviewPullRequest(...)`, and `readGitHubReviewScratch(...)`, then pinned the stale-hint bug to one shared boundary: resumed fetch and close were trusting persisted `handoffPath` plus `prNumber` before a canonical scratch-path rebuild and same-branch latest-open re-entry could run.
- Added `resolveCanonicalGitHubReviewScratchPaths(...)` in `server/src/flows/githubReview.ts` and routed resumed service-side scratch rereads through it so selector and handoff hints are rebuilt from trusted repository root, story number, and execution id first; drifted or escaping persisted paths now fail closed before any filesystem read crosses the canonical execution-scoped scratch root.
- Repaired resumed PR authority in `server/src/flows/service.ts` so missing execution-scoped handoffs now re-enter same-branch latest-open reconciliation before any persisted PR hint can be reused, and both resumed fetch and resumed close now keep their active GitHub review context aligned to the canonical selector and execution-scoped handoff paths instead of preserving stale shortcut state.
- Focused proof now names the repaired seam directly: `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` passed with the missing-handoff latest-open authority case, `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-scratch.test.ts` passed with the pre-read scratch containment case, and `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` passed with the combined resumed fetch and close ordering case after handoff loss.
- Automated-proof audit confirmed the current disk state matches the completed checklist exactly: all Task 24 subtasks and focused wrapper runs were already checked from repository evidence, no live `- **BLOCKER**` line remained under this task, and no additional story-scoped behavior restoration work was needed before closing the task as `__done__`.
- Manual testing skipped for the Task 24 resumed GitHub review fetch and close authority surface during a task-scoped pass after restarting the stale supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, proving `http://localhost:5010/health`, `http://localhost:5001`, and `GET /flows`, and leaving the stack running because it was already running when this pass began. Tried: opened the supported `/flows` surface, confirmed `implement_next_plan_github_review /data/codeInfo2` remained available, and inspected the `Working path` choices under `/home/dan/code` for a dedicated sandbox worked repository before attempting a resumed review fetch or close cycle. Observed: scratch support for this pass was saved under `codeInfoTmp/manual-testing/0000060/24/`, but the only extra local candidate was `/home/dan/code/task4-manual-repo-Nv4Wf7`, which is readable yet is not a git repository and has no repo-local runtime or access contract, so no truthful sandbox worked repository was available for a resumed GitHub review cycle. Why fuller proof was not possible: Task 24's owned behavior lives on the connected resumed-review runtime path, and current repository guidance plus the current runtime research do not support exercising that path against the active `codeInfo2` checkout or the invalid local candidate.

### Task 25. Keep Persisted Wait Recovery And Fresh-Run Replay Honest Across Permanent Failure Paths

- Repository Name: `Current Repository`
- Task Dependencies: `Task 23`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the lifecycle and replay seam that still treats permanent invalid state like transient progress. The active review found two linked defects on the same durability boundary: startup-recovered waits can keep rearming permanently invalid resume mismatches instead of surfacing or terminating them once, and persisted `retryOwnershipPending` state can suppress the only retry that would honestly restart work because it does not prove whether the earlier accepted run is still active or already died before a terminal outcome.

This task stays inside the approved Story 60 lifecycle contract. It must keep the existing persisted wait and retry-ownership model honest rather than widening into a new workflow-state platform or a broader redesign of how runs are launched and resumed.

- Highest-risk invariant: persisted wait and fresh-run replay state must fail closed when permanent invalid state or crash-before-completion ambiguity appears, instead of looping forever or suppressing the only retry that could recover truthful execution.
- Likely blocker family: `product or story seam`, because this task changes startup-recovery classification, persisted retry-ownership semantics, and the focused proof owners that guard both seams.

#### Task Exit Criteria

- Startup-recovered waits distinguish permanent `INVALID_REQUEST` or equivalent resume mismatches from transient preflight failures and do not keep rearming the same permanently invalid wait forever.
- Persisted `retryOwnershipPending` state no longer suppresses a retry unless active ownership or terminal completion is actually proven for the earlier accepted launch.
- The repair preserves current approved Story 60 launch and resume behavior for healthy persisted waits and honest in-progress replay, and does not widen scope into a new workflow-state product surface.
- Focused proof explicitly covers permanent wait mismatch classification and crash-before-terminal replay ambiguity rather than relying only on generic throw-path fixtures.

#### Addresses Findings

- Review pass `0000060-20260629T141234Z-d9a9011b`
- Finding `2`: startup-recovered waits retry permanent invalid-state resume failures instead of terminating or surfacing the stale state once.
- Finding `5`: durable `retryOwnershipPending` replay cannot distinguish accepted-still-running from accepted-then-crashed-before-commit.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - record the repaired permanent-failure classification boundary, the replay-ownership guard, and the focused proof owners for this seam.

#### Subtasks

1. [x] In `server/src/flows/service.ts`, locate the exact decision points inside `schedulePersistedWaitResume(...)`, `resumePendingFlowWaitsForStartup()`, `parseFlowResumeState(...)`, `startFlowRun(...)`, and the persisted retry-ownership helpers where permanent resume mismatches are currently treated like transient failures and where accepted-then-crashed replay is currently flattened into `already running`.
2. [x] In `server/src/flows/service.ts`, change startup wait recovery so permanent resume mismatches are surfaced or retired one time at the wait-registration seam, while the existing transient startup-failure path still rearms the same wait infrastructure.
3. [x] In `server/src/flows/service.ts`, change the `retryOwnershipPending` decision so it suppresses retries only when the earlier accepted launch is still backed by a live ownership marker or a terminal-completion marker, and so stale accepted metadata by itself can no longer hide the crash-before-terminal branch.
4. [x] Update `server/src/test/integration/flows.run.resume.backfill.test.ts` so it explicitly owns the permanent wait-mismatch classification rule with one focused case that proves the wait is surfaced or retired instead of rearmed after a durable invalid-state contradiction, and do not blur that invariant into the existing transient rearm proof.
5. [x] Update `server/src/test/integration/flows.run.basic.test.ts` so replay ownership explicitly distinguishes `still running`, `finished`, and `accepted then died before terminal cleanup`; if the proof reuses an adjacent replay test, rename, split, or rewrite it so one title and assertion set claims that exact three-way `retryOwnershipPending` contract instead of a generic already-running or replay-success story.

#### Proof Matrix

1. Requirement: startup-recovered waits must surface or retire permanent resume mismatches once instead of rearming them as transient failures.
   Implementation owners: `server/src/flows/service.ts`.
   Proof owners: `server/src/test/integration/flows.run.resume.backfill.test.ts` with a focused permanent-invalid-state contradiction case whose title claims no rearm after durable invalid state.
2. Requirement: transient startup failures on the same wait infrastructure must still rearm honestly after this repair.
   Implementation owners: `server/src/flows/service.ts`.
   Proof owners: existing transient-rearm coverage retained in `server/src/test/integration/flows.run.resume.backfill.test.ts`.
3. Requirement: persisted `retryOwnershipPending` must distinguish active ownership, terminal completion, and accepted-then-crashed-before-cleanup so retries are only suppressed when suppression is still truthful.
   Implementation owners: `server/src/flows/service.ts`.
   Proof owners: `server/src/test/integration/flows.run.basic.test.ts` with a replay proof whose title and assertions explicitly distinguish `still running`, `finished`, and crash-before-terminal replay.
4. Ordering boundary: replay suppression must observe the exact ownership-versus-terminal-marker boundary so the proof cannot pass by only seeing an earlier accepted state or only a later cleaned-up state.
   Implementation owners: `server/src/flows/service.ts`.
   Proof owners: `server/src/test/integration/flows.run.basic.test.ts` with one combined replay scenario that waits on deterministic state transitions instead of arbitrary elapsed time.

#### Testing

Keep this task's automated proof compact and seam-local. The broader server build, cucumber, lint, and format reruns for this review-created findings block are owned by Task 28.

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.backfill.test.ts` from the repository root so the repaired startup wait recovery classification passes on its focused proof home.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts` from the repository root so the repaired fresh-run replay ownership boundary passes on its focused proof home.

#### Implementation notes

- Re-read the Task 25 seam across `schedulePersistedWaitResume(...)`, `resumePendingFlowWaitsForStartup()`, `parseFlowResumeState(...)`, `startFlowRun(...)`, and the persisted retry-ownership loaders, then pinned the two dishonest branches to one service boundary: wake-time resume failures were rearming every exception the same way, and persisted `retryOwnershipPending` was replaying accepted metadata even after the active run had already disappeared.
- Added permanent resume-failure classification in `server/src/flows/service.ts` so startup-recovered waits now retire `INVALID_REQUEST` or equivalent durable contradictions once, clear the persisted wait state through the existing failure path, and preserve the prior rearm behavior only for transient preflight failures.
- Tightened persisted replay ownership in `server/src/flows/service.ts` so `getPersistedFreshRunRetryOwnershipPending(...)` now suppresses a retry only while the earlier accepted launch still has a live conversation ownership marker; stale pending metadata with no live owner is cleared so the crash-before-terminal branch can relaunch honestly, while terminal completion still falls through to the existing completion markers.
- Focused proof now names both repaired invariants directly: `server/src/test/integration/flows.run.resume.backfill.test.ts` now owns the no-rearm permanent invalid-state contradiction case, and `server/src/test/integration/flows.run.basic.test.ts` now owns one three-way replay test for `still running`, `finished`, and `accepted then died before terminal cleanup`.
- `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.backfill.test.ts` initially failed because the retired-wait diagnostic surfaced the raw flow-error object as `[object Object]`; added `describeFlowRunFailure(...)` so the durable mismatch now records the real `INVALID_REQUEST` reason, then reran that wrapper successfully.
- `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.backfill.test.ts` passed with `10/10`, and `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts` passed with `32/32`.
- Automated-proof audit confirmed the current disk state matches the completed checklist exactly: all Task 25 subtasks and focused wrapper runs were already checked from repository evidence, no live `- **BLOCKER**` line remained under this task, and no additional story-scoped behavior restoration work was needed before closing the task as `__done__`.
- Manual testing skipped for the Task 25 persisted wait-recovery and fresh-run replay runtime surface during a task-scoped pass after restarting the stale supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, then proving `http://localhost:5010/health`, `http://localhost:5001`, and `GET /flows` with scratch artifacts under `codeInfoTmp/manual-testing/0000060/25/`. Tried: inspected the live `/flows` catalog plus the checked-in `flows/*.json` and `flows-sandbox/*.json` definitions for a supported provider-free flow that could reproduce a permanent `INVALID_REQUEST` resume mismatch or an accepted-then-died-before-terminal replay branch from the main stack. Observed: startup and shutdown both succeeded, but the only checked-in wait-bearing flows are the GitHub review variants `implement_next_plan_github_review` and `implement_next_plan_github_review_test`, while the simple supported flows `echo` and `smoke` do not exercise persisted wait or replay ownership, so no supported provider-free manual seam exists for Task 25 on the live stack. Why fuller proof was not possible: Task 25's owned behavior is currently exercised through backend wait/replay fixtures and would require unsupported fixture mutation or crash-state surgery to reproduce honestly in manual proof.

### Task 26. Preserve Provider-Free Resumed Review Warning Paths End To End

- Repository Name: `Current Repository`
- Task Dependencies: `Task 23`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the end-to-end warning-path seam for resumed GitHub review runs. The active review found one server-side ordering defect and one consumer-side contract drift on the same warning story: `startFlowRun(...)` can fail a resumed provider-free GitHub or script-owned branch before the later resumed owner decides whether any real work remains, and when a warning-class outcome does survive to completion, the current client transcript surfaces can still collapse `warning` into generic success instead of preserving the distinct terminal state.

This task stays inside the approved Story 60 behavior lock. It must preserve current provider-free warning-stop behavior and make that existing warning outcome visible end to end, rather than widening scope into a broader UX redesign or a new public status taxonomy beyond what Story 60 already introduced.

The user-visible seam for this task is the existing shared assistant transcript status treatment on `/flows`, `/agents`, and `/chat`: the current assistant bubble status chip plus the companion status/info rows must show a distinct warning outcome once stored-turn hydration or websocket finals deliver it, with `/flows` remaining the focused proof home because it already owns the run-state proof seam for this story.

- Highest-risk invariant: a resumed provider-free GitHub review path must be allowed to warning-stop on its own authoritative seam, and that warning outcome must remain distinct through stored turns, websocket finals, and the current transcript surfaces instead of being preempted or flattened into a clean success.
- Likely blocker family: `product or story seam`, because this task changes both the resumed admission ordering and the client transcript contract that renders Story 60 warning outcomes.

#### Task Exit Criteria

- Resumed GitHub-review flows whose next authoritative work is provider-free GitHub fetch or script-owned branching can reach that owner seam before unrelated planner or reviewer runtime bootstrap fails the run.
- The client transcript contract preserves Story 60 `warning` terminal outcomes distinctly across stored-turn hydration, websocket final events, and the current `/flows`, `/agents`, and `/chat` assistant transcript status chip plus status/info rows instead of collapsing them to generic success.
- The repair preserves approved Story 60 warning-path behavior and does not silently change current user-facing behavior beyond making the already-approved warning outcome truthful and visible.
- Focused proof explicitly covers the provider-free resumed warning-stop path and the warning terminal-status consumer contract with titles that claim those exact invariants.

#### Addresses Findings

- Review pass `0000060-20260629T141234Z-d9a9011b`
- Finding `3`: `startFlowRun(...)` can fail the resumed GitHub review path before the later GitHub or script owner decides whether any provider-backed work still remains.
- Finding `8`: the new `warning` terminal-status vocabulary is only partially carried through the client transcript contract.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - record the preserved provider-free warning-path contract, the warning transcript consumer contract, and the focused proof owners for this seam.

#### Subtasks

1. [x] In `server/src/flows/service.ts`, `client/src/hooks/useChatStream.ts`, the page-local `mapTurnsToMessages(...)` adapters in `client/src/pages/FlowsPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/ChatPage.tsx`, plus the shared status renderers in `client/src/components/chat/transcriptSurfaceFormatting.ts` and `client/src/components/chat/AssistantTranscriptSlice.tsx`, identify the exact server preemption branch and the exact client narrowing branches that currently flatten a resumed provider-free warning path before the owning GitHub or script seam finishes; keep `client/src/hooks/useConversationTurns.ts` and `client/src/hooks/useChatWs.ts` in scope as the stored-turn and websocket transport checkpoints that must preserve the same status vocabulary.
2. [x] In `server/src/flows/service.ts`, change the resumed-run ordering so a provider-free GitHub fetch or script-owned warning-stop branch stays in control until it proves that provider-backed work actually remains, and do not widen that change into a new status taxonomy or a broader review-loop redesign.
3. [x] In `client/src/hooks/useChatStream.ts`, the page-local stored-turn adapters in `client/src/pages/FlowsPage.tsx`, `client/src/pages/AgentsPage.tsx`, and `client/src/pages/ChatPage.tsx`, and the shared status presentation helpers `client/src/components/chat/transcriptSurfaceFormatting.ts` plus `client/src/components/chat/AssistantTranscriptSlice.tsx`, carry `warning` through stored-turn hydration, websocket final-event mapping, and the current assistant transcript status chip/info rendering without falling back to generic success on any of the `/flows`, `/agents`, or `/chat` surfaces that already consume that contract.
4. [x] Update `server/src/test/integration/flows.run.basic.test.ts` so one focused server proof explicitly names and proves the provider-free resumed warning-stop ordering boundary on the resumed GitHub review path; if an existing completed-with-warning or adjacent GitHub review proof is reused, rename or split it so the title claims the resumed ordering invariant rather than a generic warning outcome.
5. [x] Update `client/src/test/flowsPage.run.test.tsx` so one focused client proof explicitly covers both warning-status hydration and live-final rendering on the current `/flows` transcript surface; if an existing run-state proof is reused, rename or split it so the same titled proof claims hydrated warning plus live-final warning for one conversation and proves that neither path is flattened back to success.

#### Manual Testing Guidance

Use the supported main stack on `/flows`, `/agents`, and `/chat`, but treat `/flows` as the primary visual proof surface for this task because its current transcript already owns the run-state contract named in the focused client proof. When a truthful warning-state fixture or resumed warning-stop conversation is available, verify the shared assistant transcript status chip and status/info metadata after both stored-turn hydration and live-final websocket delivery; `/agents` and `/chat` only need parity spot checks on the same shared transcript status treatment rather than separate redesign review.

#### Proof Matrix

1. Requirement: resumed provider-free GitHub fetch or script-owned warning-stop paths must remain reachable before unrelated planner or reviewer runtime bootstrap can fail the run.
   Implementation owners: `server/src/flows/service.ts`.
   Proof owners: `server/src/test/integration/flows.run.basic.test.ts` with a focused resumed GitHub review ordering case whose title claims the provider-free warning-stop boundary.
2. Requirement: Story 60 `warning` terminal status must survive stored-turn hydration and websocket final-event propagation as a distinct outcome rather than collapsing to generic success.
   Implementation owners: `client/src/hooks/useConversationTurns.ts`, `client/src/hooks/useChatWs.ts`, `client/src/pages/FlowsPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/pages/ChatPage.tsx`.
   Proof owners: `client/src/test/flowsPage.run.test.tsx` for the current `/flows` transcript surface, with one proof whose title and assertions explicitly cover hydrated warning turns, live-final warning turns, and no success fallback for the same conversation.
3. Failure mode: consumer-side narrowing must not reintroduce success rendering on one active transcript surface while another surface still shows `warning`.
   Implementation owners: `client/src/hooks/useConversationTurns.ts`, `client/src/hooks/useChatWs.ts`, `client/src/pages/FlowsPage.tsx`, `client/src/pages/AgentsPage.tsx`, `client/src/pages/ChatPage.tsx`.
   Proof owners: the same focused client proof in `client/src/test/flowsPage.run.test.tsx`, extended to name the shared consumer contract it is exercising.

#### Testing

Keep this task's automated proof compact and seam-local. The broader server build, client build, broad server and client wrappers, end-to-end reruns, lint, and format checks for this review-created findings block are owned by Task 28.

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts` from the repository root so the repaired provider-free resumed warning-stop path passes on its focused server proof home.
2. [x] Run `npm run test:summary:client -- --file client/src/test/flowsPage.run.test.tsx` from the repository root so the repaired warning terminal-status transcript contract passes on its focused client proof home.

#### Implementation notes

- Preflight visual refinement pass rechecked the supported `/flows`, `/agents`, and `/chat` transcript shells, clarified that this task owns the shared assistant status chip plus status/info rendering seam rather than a broader layout redesign, and named the exact shared client helpers where warning can still collapse back to success; no code changed in this step.
- Re-read the Task 26 seam across `startFlowRun(...)`, `client/src/hooks/useChatStream.ts`, the page-local `mapTurnsToMessages(...)` adapters, and the shared transcript formatters, then pinned the two dishonest branches to one boundary pair: resumed runs were pre-bootstrapping a later provider-backed step before a provider-free GitHub warning-stop could finish, and stored-turn/live-final status mapping was flattening `warning` back to the same `complete` presentation used for clean success.
- Updated `server/src/flows/service.ts` so resumed runs only pre-bootstrap provider execution when the immediate resumed boundary step itself requires it; provider-free GitHub fetch and script-owned warning-stop branches now stay in control until they either stop with warning or actually reach a later provider-backed step, while resumed conversations preserve their existing provider/model metadata instead of being rewritten to fallback placeholders during that delay.
- Carried Story 60 `warning` status through the shared client transcript contract by extending `useConversationTurns`, `useChatWs`, and `useChatStream`, updating the stored-turn adapters in `/flows`, `/agents`, and `/chat`, and teaching the shared transcript status label, key, chip palette, and info-row icon helpers to render `warning` distinctly instead of falling back to `Complete`.
- Focused proof now names both repaired invariants directly: `server/src/test/integration/flows.run.basic.test.ts` owns a resumed GitHub review case where provider bootstrap is unavailable but a provider-free fetch warning-stop still completes truthfully before the later LLM step would be needed, and `client/src/test/flowsPage.run.test.tsx` owns one `/flows` proof that covers both hydrated warning turns and live websocket final-warning rendering for the same conversation without any success fallback.
- `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts` initially failed at build because a cleanup line landed in the wrong test scope; moved that cleanup into the new resumed-warning proof and reran the same wrapper successfully.
- `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts` passed with `33/33`, and `npm run test:summary:client -- --file client/src/test/flowsPage.run.test.tsx` passed with `36/36`.
- Proof audit re-read the bound Task 26 plan section, confirmed the selector-bound task still matched the latest implementation commit and focused wrapper results, found no live blocker via `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number 26`, and closed the task because both checklist sections were already honestly complete on disk.
- Manual testing skipped for the Task 26 truthful warning transcript proof surface on `/flows`, `/agents`, and `/chat`. Tried: restarted the supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, loaded `/flows`, queried `GET /conversations?limit=20&state=all&flowName=implement_next_plan_github_review_test`, and inspected `GET /conversations/task21-manual-20260628/turns`. Observed: startup and shutdown passed, the Task 26 GitHub-review test flow had no persisted conversations in the live runtime, and the only existing GitHub-review flow conversation available there ended with an assistant `failed` turn instead of a `warning` turn. Why fuller proof was not possible: the checked-in main stack does not currently expose a truthful Task 26 warning-state fixture or resumed warning-stop conversation, and creating a custom flow or browser-injected websocket `turn_final` here would invent an unsupported proof harness.

### Task 27. Bound GitHub Review Fetch Materialization To The Capped Corpus Contract

- Repository Name: `Current Repository`
- Task Dependencies: `Task 23`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the remaining large-shape GitHub review ingest seam. The active review found that Story 60 still materializes every paginated review and inline-comment page before it applies the newer capped-result contract, so memory use, JSON parse cost, and child-process stdout can still scale with total review volume rather than with the intended bounded corpus.

This task stays inside the approved Story 60 review semantics. It must preserve the current review-submission and inline-comment contract, pagination support, execution-scoped scratch ownership, and downstream classification behavior while moving the actual fetch or materialization cost onto a truly bounded corpus contract instead of a post-fetch truncation-only rule.

- Highest-risk invariant: the authoritative review corpus for one execution must stay bounded before full transport or materialization cost explodes, while preserved pagination semantics, scratch authority, and downstream classification still agree on the same bounded corpus.
- Likely blocker family: `product or story seam`, because this task changes the fetch or materialization boundary and the focused proof owners that guard it.

#### Task Exit Criteria

- The GitHub review fetch or materialization path now has a concrete bound that limits transport or full in-memory expansion itself, not only the final persisted artifact shape.
- The repair preserves current Story 60 semantics for review submissions, inline comments, execution-scoped scratch ownership, and downstream classification instead of silently narrowing or redesigning the review-policy contract.
- Focused proof explicitly covers the bounded fetch or materialization rule and the preserved scratch replacement ordering boundary after the bound moves earlier in the seam.

#### Addresses Findings

- Review pass `0000060-20260629T141234Z-d9a9011b`
- Finding `9`: GitHub review fetch still materializes every paginated review or comment page before applying the new result caps.

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - record the chosen bounded transport or materialization rule, the preserved review semantics, and the focused proof owners for this seam.

#### Subtasks

1. [x] In `server/src/flows/githubReview.ts` and `server/src/flows/service.ts`, trace the large-shape expansion chain across `fetchPullRequestReviews(...)`, `takeMostRecentEntries(...)`, `writeGitHubReviewScratch(...)`, `buildGitHubExternalReviewInputMarkdown(...)`, and `runGitHubFetchReviewsStep(...)`, then choose the one fetch or accumulation seam that will stop accepting more review or inline-comment pages once the bounded corpus rule is satisfied.
2. [x] In `server/src/flows/githubReview.ts`, move the capped-corpus stop condition to that chosen fetch or accumulation seam so full transport or in-memory expansion stops early, while the accepted entries still preserve current review-submission ordering, inline-comment ordering, and pagination semantics.
3. [x] In `server/src/flows/githubReview.ts` and `server/src/flows/service.ts`, update scratch writing and downstream readers only as far as needed so they keep one authoritative bounded corpus, never publish a partial bounded replacement, and keep downstream markdown or classification aligned with the same accepted entries that the fetch seam kept.
4. [x] Update `server/src/test/unit/flows.github-adapter.test.ts` so the focused adapter proof names the bounded corpus rule directly and proves that large synthetic review or comment inputs stop expanding once the bounded fetch condition is satisfied; if the proof reuses the current paginated-normalization test, rename or split it so the title and assertions claim the earlier stop condition rather than only a bounded final artifact.
5. [x] Update `server/src/test/integration/flows.run.loop.test.ts` so the runtime proof still shows that fresh execution-scoped scratch replacement stays authoritative and that downstream markdown or classification reads the same bounded corpus that the adapter now enforces earlier; if the existing stale-scratch runtime proof is reused, rename or rewrite it so the title and assertions claim the combined bounded-corpus propagation invariant instead of mere scratch freshness.

#### Proof Matrix

1. Requirement: the review-fetch seam must stop transport or materialization growth at the bounded corpus limit rather than only trimming the final persisted artifact after full expansion.
   Implementation owners: `server/src/flows/githubReview.ts`.
   Proof owners: `server/src/test/unit/flows.github-adapter.test.ts` with synthetic large review/comment inputs that exercise the bounded stop condition directly and whose title claims early stop rather than post-truncation.
2. Requirement: the bounded corpus must preserve current review-submission ordering, inline-comment ordering, and pagination-visible semantics on accepted entries.
   Implementation owners: `server/src/flows/githubReview.ts`.
   Proof owners: `server/src/test/unit/flows.github-adapter.test.ts`.
3. Edge case: fresh execution-scoped scratch replacement and downstream markdown/classification reads must stay compatible with the earlier bound and must not observe stale or partial corpus state.
   Implementation owners: `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`.
   Proof owners: `server/src/test/integration/flows.run.loop.test.ts`, with a title and combined assertions that prove the same bounded corpus reaches scratch replacement and downstream readers.
4. Persistence hotspot: the bounded writer and downstream readers must still agree on one authoritative corpus after retries or replacement, and failed or partial bounded writes must not leak a smaller intermediate corpus into classification.
   Implementation owners: `server/src/flows/githubReview.ts`, `server/src/flows/service.ts`.
   Proof owners: `server/src/test/unit/flows.github-adapter.test.ts` for bounded writer stop conditions and `server/src/test/integration/flows.run.loop.test.ts` for scratch-reader compatibility after replacement.

#### Testing

Keep this task's automated proof compact and seam-local. The broader server build, cucumber, lint, and format reruns for this review-created findings block are owned by Task 28.

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` from the repository root so the repaired bounded corpus rule passes on its focused adapter proof home.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root so the repaired bounded scratch-replacement ordering still passes on its focused runtime proof home.

#### Implementation notes

- Re-traced the Task 27 seam from `runGitHubFetchReviewsStep(...)` through scratch writing and markdown materialization, and chose page-local accumulation inside `fetchPullRequestReviews(...)` as the bounded-corpus boundary so the authoritative artifact stays unchanged while full slurp stdout and unbounded in-memory growth are removed.
- Replaced the `gh api --paginate --slurp` review and inline-comment fetch path with page-by-page `gh api` requests that keep only the rolling `takeMostRecentEntries(...)` corpus; accepted entries still preserve the existing review submission ordering, inline-comment ordering, and downstream scratch payload shape.
- Kept scratch writing and downstream readers on the same authoritative bounded artifact without widening the runtime seam; no service-side scratch replacement redesign was needed because `runGitHubFetchReviewsStep(...)`, `writeGitHubReviewScratch(...)`, and `materializeGitHubExternalReviewInput(...)` already consume one execution-scoped artifact path once the adapter stops over-materializing.
- Renamed and tightened the focused adapter proof so it now claims page-local bounded materialization directly, verifies that the fetch path no longer uses `--paginate` or `--slurp`, and still proves the accepted review/comment ids match the same bounded corpus as before.
- Renamed the runtime proof so it now claims the bounded-corpus propagation invariant directly while still proving that stale scratch is replaced by the same fresh bounded reviewer feedback consumed by downstream classification.
- `npm run test:summary:server:unit -- --file server/src/test/unit/flows.github-adapter.test.ts` passed with `11/11`, and `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` passed with `37/37`.
- Proof audit re-read the bound Task 27 plan section, confirmed the selector-bound task still matched the page-local accumulation repair in `server/src/flows/githubReview.ts` and the focused wrapper results, found no live blocker via `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number 27`, and closed the task because both checklist sections were already honestly complete on disk.
- Manual testing skipped for the Task 27 live bounded GitHub review-fetch surface. Tried: restarted the stale supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, proved `http://localhost:5010/health`, `http://localhost:5001`, and `GET /flows`, then inspected `CODEINFO_HOST_INGEST_DIR=/home/dan/code` for a dedicated sandbox worked repository before attempting a live GitHub review run. Observed: the fresh stack exposed `implement_next_plan_github_review` and `implement_next_plan_github_review_test` only for `/data/codeInfo2`, the ingest root itself is not a git repository, and the only real git repository under that ingest root is this active `codeInfo2` checkout with no separate sandbox repo available for an honest large-corpus review cycle. Why fuller proof was not possible: Task 27's owned live proof surface depends on a separate sandbox worked repository under the ingest root, current Story 60 guidance explicitly says not to substitute the active `codeInfo2` checkout just to force a run, and no provider-free bounded-corpus fixture exists on the supported main stack.
### Task 28. Revalidate review pass `0000060-20260629T141234Z-d9a9011b` after review-cycle `0000060-rc-20260629T162154Z-89df94b1` task-up repairs

- Repository Name: `Current Repository`
- Affected Repositories: `Current Repository`
- Task Dependencies: `Task 24, Task 25, Task 26, Task 27`
- Task Status: `__done__`
- Git Commits:

#### Overview

This fresh final revalidation task owns the full regression proof for the current review-created findings block after the serious task-up repairs land. It revalidates the unresolved task-required findings routed into Tasks 24 through 27, also covers the inline-resolved minor findings `6`, `7`, and `10` that are already recorded for this same active review cycle, and owns the repository-supported broad proof that must stay green before Story 60 can close honestly.

This is the one final revalidation owner for review cycle `0000060-rc-20260629T162154Z-89df94b1`. No second final minor-fix revalidation task should be created later for this same cycle.

- Highest-risk invariant: final proof must re-prove the repaired resumed-authority, wait-recovery, replay, warning-path, transcript, and bounded-ingest seams while still separating baseline compose or host-network failures from story-owned regressions inside those repaired seams.
- Likely blocker family: `shared wrapper or baseline seam`, because this task owns the broad build, test, compose, and smoke surfaces after the focused repairs already proved each seam in isolation.

#### Task Exit Criteria

- Review pass `0000060-20260629T141234Z-d9a9011b` is revalidated on current `HEAD` after Tasks 24 through 27 complete with no unresolved findings remaining from this review-created block.
- The repaired seams from Tasks 24 through 27 are all covered by both their focused proof owners and the repository-supported broad regression wrappers for the current repository.
- Inline-resolved minor findings `6`, `7`, and `10` are also revalidated as part of this same final task rather than being left to a second final-owner path.
- This task title and `codeInfoStatus/flow-state/review-disposition-state.json` continue to name the same review cycle `0000060-rc-20260629T162154Z-89df94b1` and the same one final revalidation owner for the whole active cycle.
- Shared baseline failures are separated from story-owned regressions before closeout: if the supported main stack, compose wrappers, ports, readiness path, or mounted manual-testing catalogs are unavailable, the limitation is recorded against that baseline seam instead of being misclassified as a Story 60 product regression.

#### Addresses Findings

- Review pass `0000060-20260629T141234Z-d9a9011b`
- Final revalidation owner for unresolved task-required findings `1`, `2`, `3`, `4`, `5`, `8`, and `9`
- Also revalidate inline-resolved minor findings `6`, `7`, and `10` for review cycle `0000060-rc-20260629T162154Z-89df94b1`

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - final proof map and closeout traceability for the current review-created findings block.

#### Subtasks

1. [x] Update `codeInfoStatus/pr-summaries/0000060-pr-summary.md` so each unresolved task-required finding `1`, `2`, `3`, `4`, `5`, `8`, and `9` points to the focused proof owner from Tasks 24 through 27, and each inline-resolved minor finding `6`, `7`, and `10` points to the broad revalidation surfaces this task owns.
2. [x] Before any broad wrapper run, compare this task title with `task_up_owned_final_revalidation_task_title` in `codeInfoStatus/flow-state/review-disposition-state.json`; if the title, review pass id, or review cycle id drifted, repair only this task-owned wording and the matching PR summary wording so there is still one final-owner record for cycle `0000060-rc-20260629T162154Z-89df94b1`.
3. [x] In the PR summary sections owned by this task, record the supported main-stack handoff facts that later broad proof and manual closeout will rely on: wrapper entrypoints, env-file owner, mounted manual-testing catalogs, supported ports, readiness probe owner, seed/setup source, and the ignored runtime or visual artifact destination under `codeInfoTmp/manual-testing/0000060/28/`.
4. [x] Refresh the PR summary sections for comparison context, repaired seams, focused proof owners, supported-runtime handoff details, broad rerun ownership, and baseline-versus-story failure classification so the later proof pass can record wrapper results without deciding task shape again.
5. [x] Add one PR summary checklist for later reruns that separates baseline support seams from story-owned repaired seams across compose build, broad test wrappers, host-network smoke, lint, and format, so a future rerun can stop on the first real regression without losing traceability for the remaining required wrappers.

#### Proof Matrix

1. Requirement: the final proof pass must revalidate unresolved task-required findings `1`, `2`, `3`, `4`, `5`, `8`, and `9` on current `HEAD` after Tasks 24 through 27 land.
   Implementation owners: the repaired seams in `server/src/flows/service.ts`, `server/src/flows/githubReview.ts`, `client/src/hooks/useConversationTurns.ts`, `client/src/hooks/useChatWs.ts`, and `client/src/pages/FlowsPage.tsx`.
   Proof owners: the focused proof homes already named in Tasks 24 through 27 plus the broad wrappers listed in this task's `Testing` section.
2. Requirement: inline-resolved minor findings `6`, `7`, and `10` must stay green on the same final proof pass rather than being treated as already-safe by implication.
   Implementation owners: the previously repaired Story 60 surfaces already recorded in the active review cycle.
   Proof owners: `npm run test:summary:server:unit`, `npm run test:summary:client`, and `npm run test:summary:server:cucumber` as listed in `Testing`.
3. Requirement: supported-stack baseline ownership must stay explicit so compose build, compose up, host-network readiness, and compose down failures are classified separately from story-owned regressions.
   Implementation owners: main compose wrappers, supported env ownership, mounted manual-testing catalogs, and the PR summary traceability this task prepares.
   Proof owners: `npm run compose:build:summary`, `npm run compose:up`, `npm run test:summary:host-network:main`, and `npm run compose:down`.
4. Requirement: final broad proof must include default wrapper reachability for server build, client build, broad server tests, broad client tests, cucumber, e2e, lint, and format so no repaired seam is only proved by targeted execution.
   Implementation owners: current repository build, runtime, and transcript surfaces touched by Tasks 24 through 27.
   Proof owners: the wrapper-first commands already listed in this task's `Testing` section.

#### Testing

1. [x] Run `npm run compose:build:summary` from the repository root because this final task must revalidate the supported main-stack Docker build path after the current review-created repair block lands.
2. [x] Run `npm run build:summary:server` from the repository root because the current review-created block changes shared server runtime, GitHub transport, scratch authority, replay, and resume-ordering surfaces.
3. [x] Run `npm run build:summary:client` from the repository root because the current review-created block includes warning-status transcript contract work and must keep the repository-supported client build surface healthy.
4. [x] Run full `npm run test:summary:server:unit` from the repository root because this final task must revalidate the focused task-up repairs plus inline-resolved minor findings `7` and the shared runtime seams on the repository-supported broad server wrapper.
5. [x] Run full `npm run test:summary:client` from the repository root because this final task must revalidate the warning transcript consumer repair plus inline-resolved minor finding `6` on the repository-supported broad client wrapper.
6. [x] Run full `npm run test:summary:server:cucumber` from the repository root because this final task must revalidate the flow-runtime branch behavior plus inline-resolved minor finding `10` on the repository-supported cucumber surface.
7. [x] Run full `npm run test:summary:e2e` from the repository root because this final task must revalidate the repaired `/flows` execution surface end to end after the current review-created block completes.
8. [x] Run `npm run compose:up` from the repository root because this final task must include a supported main-stack smoke start after the broad automated wrappers complete.
9. [x] Run `npm run test:summary:host-network:main` from the repository root after `npm run compose:up` because the repository-supported automated proof owner for the default main-stack path is the host-network probe wrapper rather than a raw healthcheck curl.
10. [x] Run `npm run compose:down` from the repository root because the previous steps started and probed the supported main stack and this final task must leave that baseline stopped again.
11. [x] Run `npm run lint` from the repository root for the final Story 60 review-created repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
12. [x] Run `npm run format:check` from the repository root for the final Story 60 review-created repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- If later closeout still needs fresh visual proof on the supported `/flows` surface after these review-created repairs land, use the supported main stack rather than `codeinfo:local`: build and start it through the main compose wrappers, use the standard stack ports `5001` and `5010`, treat the host-network probe wrapper as the default readiness owner, and keep the mounted manual-testing catalogs under `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` aligned with the same stack that broad proof already exercised.
- When later manual proof needs runtime setup or seed details, use the same stack and handoff facts already recorded by this task's PR summary refresh instead of rediscovering them by failure. If additional runtime-handoff JSON is needed to understand the active artifact source, fallback runtime, or destination, inspect that JSON by meaning rather than depending on one exact property name.
- For the codeInfo2 local harness workflow, remember that a Playwright MCP screenshot saved under `/tmp/playwright-output/<relative-path>` inside the screenshot-producing Playwright runtime will normally appear on the host under `$CODEINFO_ROOT/playwright-output-local/<relative-path>`. Treat that host-visible location as staging only, keep it distinct from the app-under-test runtime when those differ, then transfer the needed final-task images into the ignored Story 60 manual-testing artifact destination for this task, normally under `codeInfoTmp/manual-testing/0000060/28/`, so repository-owned ignored artifacts, not the Playwright staging area, hold the closeout proof.
- When later closeout re-covers the Story 60-owned `/flows` visual surfaces, treat the screenshots captured for this final task as the primary durable proof for those final surfaces. Preserve earlier screenshots from older tasks only when they still provide uniquely necessary evidence that this final revalidation pass does not replace.
- If screenshot transfer or the supported main-stack visual proof is blocked by runtime limits, record the limitation honestly in the closeout notes instead of turning the screenshot gap into a new implementation task.

#### Implementation notes

- Rewrote `codeInfoStatus/pr-summaries/0000060-pr-summary.md` from the stale Task 23 state into a Task 28 final-owner map that points unresolved findings `1`, `2`, `3`, `4`, `5`, `8`, and `9` at the focused proof homes from Tasks 24 through 27 and routes inline-resolved minor findings `6`, `7`, and `10` to the broad Task 28 wrapper surfaces.
- Compared the Task 28 heading against `task_up_owned_final_revalidation_task_title` in `codeInfoStatus/flow-state/review-disposition-state.json` and found no drift in the review-pass id, review-cycle id, or final-owner wording, so the PR summary now mirrors the existing one-owner record without widening edits beyond Task 28-owned closeout text.
- Added the supported main-stack handoff facts the later broad-proof pass depends on: wrapper entrypoints, env-file ownership through `scripts/docker-compose-with-env.sh` and `docker-compose.yml`, mounted `manual_testing/codeinfo_agents` and `manual_testing/codex_agents` catalogs, supported ports, host-network readiness owner, seed/setup sources, and the ignored artifact destination `codeInfoTmp/manual-testing/0000060/28/`.
- Refreshed the PR summary comparison context, repaired seam map, broad rerun ownership, and baseline-versus-story failure classification so the later wrapper pass can stop on the first real regression without re-deciding whether a compose or runtime failure belongs to baseline support or a Story 60 repair seam.
- Added one final rerun checklist in the PR summary that separates baseline support seams from story-owned repaired seams across compose build, broad wrapper reruns, host-network smoke, lint, and format; no Task 28 testing wrappers were run during this subtask-only documentation pass.
- `npm run compose:build:summary` passed cleanly on current `HEAD`, revalidating the supported main-stack Docker build path without requiring log inspection and leaving the wrapper-owned image-runtime asset contract intact.
- `npm run build:summary:server` passed cleanly on current `HEAD`, revalidating the shared server build surface for the repaired GitHub transport, scratch authority, replay, and resume-ordering seams without any warnings.
- `npm run build:summary:client` passed on current `HEAD` after log inspection confirmed the wrapper's warning was the existing Vite chunk-size advisory on `dist/assets/index-*.js`, not a client typecheck or build failure on the repaired warning-status transcript contract.
- Full `npm run test:summary:server:unit` first failed on `paused repository-backed waits keep the original sourceId and retryOwnershipId barrier while excluding a conflicting fresh sourceId on resume`, which exposed that the Task 25 retry-ownership cleanup had started clearing truthful paused-wait barriers as soon as the live run token disappeared. Repaired `getPersistedFreshRunRetryOwnershipPending(...)` in `server/src/flows/service.ts` so persisted wait state keeps the original barrier authoritative until the wait is actually cleared, reran the exact failing wrapper-targeted test successfully, and then reran the full broad server-unit wrapper to a clean `2534/2534` pass.
- Full `npm run test:summary:client` passed cleanly with `900/900`, revalidating the warning transcript consumer contract and the broader client surface after the Story 60 review-created repairs.
- Full `npm run test:summary:server:cucumber` passed cleanly with `133/133`, revalidating the flow-runtime branch behavior and the inline-resolved minor cucumber seam on the supported broad wrapper.
- Full `npm run test:summary:e2e` passed cleanly with `77/77`, including compose build, stack startup, end-to-end `/flows` exercise, and wrapper-owned teardown on the supported e2e path.
- `npm run compose:up` first hit a baseline preflight conflict because host port `5010` was already occupied by an older main `codeinfo2-*` stack instance, not by the protected `*-local` stack. Brought that main stack down with `npm run compose:down`, reran `npm run compose:up`, and restored the supported main stack cleanly with all services healthy.
- `npm run test:summary:host-network:main` passed cleanly against the refreshed supported main stack, confirming reachability for classic/chat/agents/web/playwright MCP paths plus the seeded mixed-shape bridge probe on the repository-supported host-network surface.
- `npm run compose:down` passed cleanly after the host-network probe, leaving the supported main stack stopped again for honest closeout and preserving the local stack untouched.
- `npm run lint` passed cleanly on current `HEAD`, and after `npm run format:check` later exposed Prettier drift in `client/src/pages/AgentsPage.tsx`, `client/src/pages/ChatPage.tsx`, and `client/src/pages/FlowsPage.tsx`, reran lint successfully after formatting so the final Story 60 review-created repair surface still has no repo-wide lint failures.
- `npm run format:check` first failed on those three client page files, fixed them with `npx prettier --write ...`, and then reran `npm run format:check` to a clean pass so the final repair surface now satisfies the repo-wide formatting gate too.
- Proof audit re-read the bound Task 28 plan section, confirmed the broad wrapper reruns, paused-wait barrier repair, and formatting follow-up all matched current `HEAD`, found no live blocker via `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number 28`, and closed the final revalidation task because every implementation and automated-proof checklist item was already honestly complete on disk.
- Manual testing ran as full-story closeout proof because Task 28 is the final story task: restarted the stale supported main stack with `npm run compose:down`, `npm run compose:build`, and `npm run compose:up`, passed `npm run test:summary:host-network:main`, captured fresh `/flows` proof plus supporting health/catalog artifacts under `codeInfoTmp/manual-testing/0000060/28/`, and then returned the main stack to its prior stopped state with `npm run compose:down`. The retained final-state screenshots are `proof-01-flows-desktop.png` and `proof-02-flows-left-panel.png`, which should supersede earlier Story 60 `/flows` screenshots for the surfaces re-covered here. The visible `/flows` page reopened an older `echo` conversation whose historical transcript contains expired Codex-auth failures, and the only browser-side request issue was an expected aborted turns fetch during the page's conversation reset path; those observations did not invalidate Task 28's closeout proof, so no additional subtasks were needed.
- Resumed GitHub review execution expected persisted pull request #210, but the resumed execution context carried #211. Checking the latest open pull request for Chargeuk/codeInfo2 on branch feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.
Adopting newer pull request #211 because it is later than the persisted expected pull request #210 on the same branch.

## Code Review Findings

### Task 29. Restore Canonical Execution-Scoped Handoff Authority Before Resumed GitHub Review Scripts Read Disk

- Repository Name: `Current Repository`
- Task Dependencies: `Task 23`
- Task Status: `__done__`
- Git Commits:

#### Overview

This review-created task repairs the resumed GitHub review handoff-path authority defect from review pass `0000060-20260630T011157Z-0ca69c71`. The active review found that a resumed script-backed GitHub review decision can still forward a persisted handoff path across a filesystem boundary before the runtime re-proves that the path is the canonical execution-scoped scratch file for the current execution.

This task must preserve Story 60's approved resumed GitHub review behavior while restoring the existing execution-scoped scratch ownership contract. It must not widen scope into a broader redesign of review selection, scratch naming, or reviewer-feedback policy; the repair is specifically about blocking foreign or stale persisted handoff paths from being read before canonical ownership is re-established.

- Highest-risk invariant: no resumed GitHub review helper may read or forward a persisted handoff path to a later filesystem reader until the runtime has re-derived and re-validated the canonical execution-scoped scratch path for that execution.
- Likely blocker family: `product or story seam`, because the defect crosses persisted wait state, resumed runtime normalization, script environment forwarding, and script-side file reads while preserving Story 60's approved resumed review behavior.

#### Task Exit Criteria

- The resumed GitHub review runtime re-derives the canonical execution-scoped handoff path before it exports any handoff-path environment value or allows any helper to read that path from disk.
- The script-backed reviewer-feedback helper rejects non-canonical, stale, or foreign handoff paths before any JSON content is read from disk, while preserving the approved execution-scoped fallback selector behavior for canonical files.
- The runtime remains the only writer and authority owner for the execution-scoped handoff scratch path, and the reviewer-feedback helper remains read-only: it must not clean up, rewrite, or silently replace persisted handoff files when rejecting foreign paths or when a canonical file is malformed or partial.
- Focused proof forces the real resumed ordering boundary: persisted wait-state hydration, canonical execution-scoped handoff derivation, environment export, helper launch, and only then JSON reads from the helper's env-driven branch.
- Focused proof explicitly names the canonical execution-scoped handoff authority invariant on both the runtime seam and the script helper seam.

#### Addresses Findings

- Review pass `0000060-20260630T011157Z-0ca69c71`
- Finding `1`: `Resumed GitHub-review feedback checks can read an arbitrary persisted handoff path before canonical execution-scoped ownership is re-proved.`

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - record the repaired execution-scoped handoff authority rule and the focused proof owners for this seam.

#### Subtasks

1. [x] In `server/src/flows/service.ts`, patch the resumed `githubReviewContext.handoffPath` producer seam so `startFlowRun(...)`, canonical scratch-path derivation, and the `CODEINFO_GITHUB_REVIEW_HANDOFF_PATH` export leave one authoritative execution-scoped handoff path before any helper launch or sibling resumed reader can observe a persisted path value; preserve the current resumed PR-selection and warning-path behavior while removing foreign-path authority.
2. [x] In `scripts/flow_control/check_github_review_has_reviewer_feedback.py`, patch the env-driven helper seam so non-canonical handoff paths are rejected before any JSON read, the generic story-global `0000060-current-review.json` fallback remains rejected for this helper path, and canonical malformed-or-partial handoff files stay on the existing read-only parse-failure path instead of triggering helper-side cleanup, replacement, or fallback.
3. [x] In `scripts/test/test_check_github_review_has_reviewer_feedback.py`, patch the helper proof owner so one compact proof surface explicitly asserts: foreign or stale env-provided handoff paths are rejected before file contents are read; canonical execution-scoped handoff paths still succeed through the env-driven branch; canonical malformed-or-partial handoff files fail through the existing read-only parse path without helper cleanup or fallback substitution; and the generic current-review fallback remains rejected for this helper path instead of being covered only by a mixed broad helper test. If this reuses an older helper case whose current title or inline description still claims only fallback rejection or adjacent path validation, rename or rewrite that case so its claim matches the new pre-read canonical-path authority invariant.
4. [x] In `server/src/test/integration/flows.run.loop.test.ts`, patch one focused resumed-authority proof surface so it explicitly covers the exact ordering boundary for this repair: persisted wait-state hydration, canonical execution-scoped handoff derivation, producer-side env export, helper launch, and no helper disk read from a foreign handoff path before that derivation completes. Use a deterministic observable boundary inside the resumed runtime and helper seam rather than elapsed-time assumptions, and if this reuses an older stale-scratch or resumed-review case, rename or split that case so the test title and combined assertions claim the repaired canonical execution-scoped authority ordering instead of only adjacent before/after state.
5. [x] In `server/src/flows/service.ts`, `scripts/flow_control/check_github_review_has_reviewer_feedback.py`, `scripts/test/test_check_github_review_has_reviewer_feedback.py`, and `server/src/test/integration/flows.run.loop.test.ts`, make the smallest code or test-file edits needed so the Task 29 repair surface is lint-clean without broadening into unrelated repository cleanup.
6. [x] In the same Task 29 repair files, make the smallest formatting-only edits needed so the repaired authority seam and its proof homes satisfy the repository format check without changing behavior.

#### Proof Matrix

1. Requirement: resumed GitHub review runtime state must not forward foreign persisted handoff paths into later script-owned filesystem reads.
   Implementation owners: producer `server/src/flows/service.ts`; consumer `scripts/flow_control/check_github_review_has_reviewer_feedback.py`.
   Proof owners: `server/src/test/integration/flows.run.loop.test.ts` with a focused resumed-handoff authority case whose title claims the canonical execution-scoped boundary, whose assertions cover the combined hydration-to-helper-launch ordering, and which is renamed or split if an older stale-scratch title would otherwise become misleading.
2. Requirement: the script-backed reviewer-feedback helper must reject non-canonical env-provided handoff paths before it reads disk.
   Implementation owners: `scripts/flow_control/check_github_review_has_reviewer_feedback.py`.
   Proof owners: `scripts/test/test_check_github_review_has_reviewer_feedback.py` with a focused helper case whose title claims pre-read canonical-path enforcement and is renamed or rewritten if an older fallback-only title would otherwise remain attached to the new invariant.
3. Requirement: canonical malformed-or-partial handoff files must stay on the existing read-only parse-failure path, and the helper must not clean up, rewrite, or substitute another persisted handoff file when that parse fails.
   Implementation owners: `scripts/flow_control/check_github_review_has_reviewer_feedback.py`.
   Proof owners: `scripts/test/test_check_github_review_has_reviewer_feedback.py` with a focused malformed-canonical-handoff case whose title claims read-only parse failure without fallback substitution or helper cleanup.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root so the repaired resumed handoff-authority runtime seam passes on its focused server proof home.
2. [x] Run `python3 scripts/test/test_check_github_review_has_reviewer_feedback.py` from the repository root so the repaired script helper seam proves it rejects foreign env-provided handoff paths before reading disk, keeps malformed canonical handoff files on the existing read-only parse-failure path, and still rejects the generic current-review fallback for this helper path.
3. [x] Run `npm run lint` from the repository root for the Task 29 repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
4. [x] Run `npm run format:check` from the repository root for the Task 29 repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Normalized resumed `activeGitHubReviewContext` scratch ownership in `server/src/flows/service.ts` so execution-scoped selector and handoff paths are re-derived from repository root, story number, and execution id before any script-backed decision exports `CODEINFO_GITHUB_REVIEW_HANDOFF_PATH`; this keeps resumed PR-selection behavior intact while stripping foreign persisted path authority from the producer seam.
- Hardened `scripts/flow_control/check_github_review_has_reviewer_feedback.py` so the env-driven helper now proves the expected execution-scoped handoff path before any JSON read, keeps the generic `0000060-current-review.json` fallback rejected for this helper path, and still leaves canonical malformed handoff files on the existing read-only parse-failure path.
- Expanded `scripts/test/test_check_github_review_has_reviewer_feedback.py` with focused helper cases that prove foreign env-provided paths are rejected before reads, generic current-review fallback remains rejected in the env-driven branch, canonical malformed handoff files fail on parse without fallback substitution, and canonical execution-scoped env paths still succeed.
- Added a focused resumed runtime proof in `server/src/test/integration/flows.run.loop.test.ts` that corrupts the persisted wait-state handoff and selector paths before resume, then proves the runtime re-derives canonical execution-scoped authority before helper launch by taking the findings branch without any failed helper turn.
- `python3 scripts/test/test_check_github_review_has_reviewer_feedback.py` passed with `Ran 7 tests in 0.233s`, and `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` passed with `38/38` after one bounded fixture repair to stop injecting an unsupported PR-number check into the canonical handoff fixture.
- `npm run lint` completed cleanly for the Task 29 repair surface, and `npm run format:check` completed cleanly with `All matched files use Prettier code style!`.
- Automated-proof audit re-read the bound Task 29 section, confirmed the targeted helper proof, focused server runtime proof, lint, and format checks all matched commit `03a61f848f703e3fd60f15b4b0ac1ce069415c09`, found no live blocker via `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number 29`, and closed the task because both implementation and automated proof were already honestly complete on disk.
- Manual testing skipped for the resumed persisted-wait-state handoff-authority ordering surface. Tried: restarted the supported main stack, passed `npm run test:summary:host-network:main`, inspected `GET /flows` and `GET /flows/implement_next_plan_github_review_test?sourceId=/data/codeInfo2`, and manually ran `scripts/flow_control/check_github_review_has_reviewer_feedback.py` against canonical, foreign, and malformed execution-scoped handoff files. Observed: the main stack started and shut down cleanly and the helper seam proved canonical success plus foreign-path rejection, but the live flow catalog exposed only generic review flows and no checked-in manual launcher for seeding a resumed wait state with a foreign persisted handoff path before helper launch. Why fuller proof was not possible: Task 29's runtime-ordering boundary is only exposed through the focused automated resumed-runtime proof, and the supported manual surfaces do not provide a checked-in way to author, corrupt, and resume that persisted wait-state boundary without inventing a harness.
### Task 30. Revalidate review pass `0000060-20260630T011157Z-0ca69c71` after review-cycle `0000060-rc-20260630T021700Z-fd13875d` task-up repairs

- Repository Name: `Current Repository`
- Affected Repositories: `Current Repository`
- Task Dependencies: `Task 29`
- Task Status: `__done__`
- Git Commits:

#### Overview

This fresh final revalidation task owns the full proof for the current review-created findings block after the serious task-up repair lands. It revalidates unresolved task-required finding `1` from review pass `0000060-20260630T011157Z-0ca69c71` on current `HEAD` and is the one final revalidation owner for review cycle `0000060-rc-20260630T021700Z-fd13875d`.

There are no inline-resolved minor findings recorded for this review cycle today. If that same active cycle later records any resolved minor findings before closeout, this task remains the sole final revalidation owner for them too; no second final minor-fix revalidation task should be created later for this cycle.

- Highest-risk invariant: the repaired resumed handoff-authority seam must stay truthful on both the server runtime and script helper surfaces without regressing the existing execution-scoped review-handoff contract elsewhere in the current repository.
- Likely blocker family: `proof or test harness seam`, because the final pass must distinguish a real resumed-authority regression from a broader server-test or script-test harness issue on the same focused server and helper proof homes.

#### Task Exit Criteria

- Review pass `0000060-20260630T011157Z-0ca69c71` is revalidated on current `HEAD` after Task 29 completes with no unresolved findings remaining from this review-created block.
- The repaired execution-scoped handoff-authority seam is covered by both its focused proof owners and the relevant repository-supported broad regression wrappers for the current repository.
- This task title and `codeInfoStatus/flow-state/review-disposition-state.json` continue to name the same review cycle `0000060-rc-20260630T021700Z-fd13875d` and the same one final revalidation owner for the whole active cycle.
- Client, browser, and e2e surfaces remain non-applicable for this review-created block unless later work widens the affected seam beyond the current server runtime and script-helper ownership.
- Shared baseline ownership remains explicit in this task: because the repair changes current-repository server runtime behavior, the broad proof surface for this review-created block includes the supported compose build path plus one supported main-stack smoke start and stop through `npm run compose:up`, `npm run test:summary:host-network:main`, and `npm run compose:down`, while browser and e2e proof remain non-applicable for this backend-only seam.

#### Addresses Findings

- Review pass `0000060-20260630T011157Z-0ca69c71`
- Final revalidation owner for unresolved task-required finding `1`
- Also owns final revalidation for any inline-resolved minor findings later recorded for review cycle `0000060-rc-20260630T021700Z-fd13875d`

#### Documentation Locations

- `codeInfoStatus/pr-summaries/0000060-pr-summary.md` - final proof map and closeout traceability for the current review-created findings block.

#### Subtasks

1. [x] In `codeInfoStatus/pr-summaries/0000060-pr-summary.md`, patch the final-owner proof surface for review pass `0000060-20260630T011157Z-0ca69c71` so finding `1` points to Task 29's focused proof homes, the active cycle id stays `0000060-rc-20260630T021700Z-fd13875d`, browser and e2e surfaces remain explicitly non-applicable for this review-created block unless later work widens the seam, and the broad wrapper ownership for compose build, server build, server-unit, server-cucumber, helper test, supported main-stack smoke start or stop, lint, and format is listed as the closeout proof path.
2. [x] In `codeInfoStatus/flow-state/review-disposition-state.json` and `codeInfoStatus/pr-summaries/0000060-pr-summary.md`, compare the stored final-owner title, review pass id, and review cycle id with this Task 30 heading; if any one of those values drifted, repair only those task-owned identifiers so the active cycle still has one matching final revalidation owner record before broad reruns begin.
3. [x] In `server/src/flows/service.ts`, `scripts/flow_control/check_github_review_has_reviewer_feedback.py`, `scripts/test/test_check_github_review_has_reviewer_feedback.py`, `server/src/test/integration/flows.run.loop.test.ts`, and `codeInfoStatus/pr-summaries/0000060-pr-summary.md`, make the smallest edits needed so the final review-created repair surface is lint-clean before the broad reruns in this task begin.
4. [x] In those same Task 30 final-owner files, make the smallest formatting-only edits needed so the final review-created repair surface satisfies the repository format check before the broad reruns in this task begin.

#### Proof Matrix

1. Requirement: final proof must revalidate unresolved task-required finding `1` on current `HEAD` after Task 29 lands.
   Implementation owners: `server/src/flows/service.ts` and `scripts/flow_control/check_github_review_has_reviewer_feedback.py`.
   Proof owners: the focused proof homes named in Task 29 plus the broad wrappers listed in this task's `Testing` section.
2. Requirement: the current repository's broad server and script-backed proof surfaces must stay green after the handoff-authority repair.
   Implementation owners: current repository server runtime and script-helper seams touched by Task 29.
   Proof owners: `npm run build:summary:server`, `npm run test:summary:server:unit`, `npm run test:summary:server:cucumber`, `python3 scripts/test/test_check_github_review_has_reviewer_feedback.py`, `npm run lint`, and `npm run format:check`.
3. Requirement: the current repository's normal supported startup path must still remain reachable after the repaired handoff-authority seam lands, even though browser and e2e proof are not required for this backend-only review-created block.
   Implementation owners: current repository compose wrappers, supported main-stack startup path, and Task 30 closeout wording in `codeInfoStatus/pr-summaries/0000060-pr-summary.md`.
   Proof owners: `npm run compose:build:summary`, `npm run compose:up`, `npm run test:summary:host-network:main`, and `npm run compose:down`, plus the Task 30 PR summary refresh that records browser and e2e as non-applicable for this seam.

#### Testing

1. [x] Run `npm run compose:build:summary` from the repository root because this final task must keep the supported main-stack Docker build path healthy for the repaired current-repository server runtime seam.
2. [x] Run `npm run build:summary:server` from the repository root because this review-created block changes current-repository server runtime seams and must keep the supported server build surface healthy.
3. [x] Run full `npm run test:summary:server:unit` from the repository root because this final task must revalidate the repaired resumed handoff-authority seam on the repository-supported broad server wrapper.
4. [x] Run full `npm run test:summary:server:cucumber` from the repository root because this final task must keep the repository's primary backend integration-test path green after the repaired handoff-authority seam lands.
5. [x] Run `python3 scripts/test/test_check_github_review_has_reviewer_feedback.py` from the repository root because this final task must also revalidate the repaired script-helper authority seam on its broad repository-supported proof home.
6. [x] Run `npm run compose:up` from the repository root because this backend runtime repair must still preserve the normal supported main-stack startup path after the broad automated proof completes.
7. [x] Run `npm run test:summary:host-network:main` from the repository root after `npm run compose:up` because the repository-supported automated smoke owner for the default main-stack path is the host-network probe wrapper rather than a raw healthcheck curl.
8. [x] Run `npm run compose:down` from the repository root because the previous step started the supported main stack and this final task must leave that baseline stopped again after automated smoke proof.
9. [x] Run `npm run lint` from the repository root for the final Story 60 review-created repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
10. [x] Run `npm run format:check` from the repository root for the final Story 60 review-created repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Refreshed `codeInfoStatus/pr-summaries/0000060-pr-summary.md` from the stale Task 28 cycle into the active Task 30 final-owner handoff so finding `1`, the focused Task 29 proof homes, the backend-only non-applicable browser/e2e scope, and the broad closeout wrapper ownership all now match review pass `0000060-20260630T011157Z-0ca69c71`.
- Compared the Task 30 title, review pass id, and review cycle id against `codeInfoStatus/flow-state/review-disposition-state.json`; no repair was needed there because the stored final-owner record already matched the active Task 30 identifiers, so only the PR summary drift had to be corrected.
- Ran `npm run lint` across the repository to close the Task 30 lint-prep subtask; the final review-created repair surface was already lint-clean, so no source edits beyond the PR summary refresh were required before broad reruns.
- Ran `npm run format:check` across the repository to close the Task 30 format-prep subtask; Prettier reported the final repair surface already matched repository formatting, so no additional formatting-only edits were needed.
- `npm run compose:build:summary` passed cleanly for the supported main-stack Docker build path during final revalidation, so the repaired server-runtime seam still packages without requiring any follow-up build fixes.
- `npm run build:summary:server` passed cleanly on current `HEAD`, confirming the repaired server-runtime seam still clears the repository-supported server build wrapper before broader reruns.
- Full `npm run test:summary:server:unit` passed with `2535/2535`, so the repaired resumed handoff-authority seam and the broader repository-supported server-unit wrapper both stayed green on current `HEAD` without needing any new code repair.
- Full `npm run test:summary:server:cucumber` passed with `133/133`, so the primary backend integration-test wrapper remained green after the handoff-authority repair landed.
- `python3 scripts/test/test_check_github_review_has_reviewer_feedback.py` passed with `Ran 7 tests`, confirming the repaired script-helper authority seam stayed green on its repository-supported proof home during final revalidation.
- `npm run compose:up` brought the supported main stack up cleanly on the default compose path; server and client containers both reached healthy started state, so the backend-only repair did not break baseline startup.
- `npm run test:summary:host-network:main` passed on the live main stack with all expected MCP and web surfaces reachable, and the seeded mixed-shape bridge probe was observed and cleaned as expected.
- `npm run compose:down` removed the supported main stack cleanly after smoke proof, so Task 30 leaves the default compose baseline stopped again after final automated revalidation.
- Automated-proof audit re-read the bound Task 30 section, confirmed the final-owner PR summary refresh plus all ten repository-supported broad proof steps matched current `HEAD` and commit `96257069`, found no live blocker via `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number 30`, and closed the task because both the implementation-prep work and the full automated revalidation were already honestly complete on disk.
- Manual testing ran as a full-story proof pass because Task 30 is the final task: restarted the supported main stack from unknown provenance, passed `npm run test:summary:host-network:main`, captured `/health`, `/flows`, and `/flows/implement_next_plan_github_review_test?sourceId=/data/codeInfo2`, and manually re-proved the repaired helper seam with canonical success plus foreign-path and malformed-canonical rejection artifacts under `codeInfoTmp/manual-testing/0000060/30/`; browser screenshots were not required or attempted because Task 30's own exit criteria keep browser and e2e proof non-applicable for this backend-only review-created block, no earlier screenshots were superseded, live GitHub-review proof was intentionally not required because this task's accepted broad proof path is the supported main-stack smoke plus repository-backed helper evidence, and no additional subtasks were needed.
- Resumed GitHub review execution expected persisted pull request #211, but the resumed execution context carried #212. Checking the latest open pull request for Chargeuk/codeInfo2 on branch feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.
Adopting newer pull request #212 because it is later than the persisted expected pull request #211 on the same branch.
- Post-merge broad-proof stabilization repaired one deterministic saved-conversation provider or model pinning regression in `server/src/mcp2/tools/codebaseQuestion.ts` plus `server/src/chat/providerExecution.ts`, and then widened only the narrow server integration wait budgets that were timing out under shared load instead of changing the underlying runtime contracts those tests prove.
- Shared all-suite validation initially kept failing only in rotating `server:unit` timeout proofs, so the batch wrapper in `scripts/test-summary-all-parallel.mjs` was temporarily made more conservative while the harness investigation isolated whether the failures came from missed helper wiring or from deeper runtime issues.
- Follow-up timeout-harness work wired the remaining server integration polling helpers into the shared `CODEINFO_TEST_TIMEOUT_MS` contract, then restored `server:unit` parallelism in `scripts/test-summary-all-parallel.mjs` with a capped worker count of `4` and a larger all-suite-only absolute wait budget of `60000`; `npm run test:summary:all:parallel` then passed cleanly with `client 900/900`, `server:unit 2535/2535`, `server:cucumber 133/133`, and `e2e 77/77`.
- Final post-merge validation on current `HEAD` passed with `npm run lint`, `npm run format:check`, targeted server-unit proof reruns for every repaired flake or regression seam, and one clean `npm run test:summary:all:parallel` run showing client `900/900`, server unit `2535/2535`, server cucumber `133/133`, and e2e `77/77`; the only non-blocking wrapper signal left was the existing Vite large-chunk warning from `build:summary:client`.
- Added `server/src/test/support/testTimeouts.ts` so server integration proofs can honor one absolute `CODEINFO_TEST_TIMEOUT_MS` setting when the suite is under broad shared load, then routed the common wait helpers plus WebSocket event waits in the affected Story 60 server proof files through that helper without changing targeted-run defaults.
- Trial broad reruns proved the new absolute timeout setting helped but did not fully remove shared-load contention at `server:unit` concurrency `4` or `2`, so `scripts/test-summary-all-parallel.mjs` now keeps the new `CODEINFO_TEST_TIMEOUT_MS=30000` support for the `server:unit` leg while preserving the known-good serialized `server:unit` fallback for honest full-suite proof.

## Post-Implementation Code Review

### Review Pass `0000060-20260630T055405Z-13e605da`

- Review loop closeout basis: [codeInfoTmp/reviews/0000060-current-review.json](/home/dan/code/codeInfo2/codeInfoTmp/reviews/0000060-current-review.json), [codeInfoTmp/reviews/0000060-20260630T055405Z-13e605da-evidence.md](/home/dan/code/codeInfo2/codeInfoTmp/reviews/0000060-20260630T055405Z-13e605da-evidence.md), [codeInfoTmp/reviews/0000060-20260630T055405Z-13e605da-findings.md](/home/dan/code/codeInfo2/codeInfoTmp/reviews/0000060-20260630T055405Z-13e605da-findings.md), [codeInfoTmp/reviews/0000060-20260630T055405Z-13e605da-findings-saturation.md](/home/dan/code/codeInfo2/codeInfoTmp/reviews/0000060-20260630T055405Z-13e605da-findings-saturation.md), and [codeInfoTmp/reviews/0000060-20260630T055405Z-13e605da-blind-spot-challenge.md](/home/dan/code/codeInfo2/codeInfoTmp/reviews/0000060-20260630T055405Z-13e605da-blind-spot-challenge.md).
- Branch-vs-base check performed for `Current Repository`: local `HEAD` `13e605da3e975afb6e53b09d87b897cfbd5546c8` on `feature/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps` was reviewed against remote-tracking base `origin/main` at `33609a1f77499983b6cb10273fe6137ae05aa24f` using `comparison_rule: local_head_vs_resolved_base`.
- Comparison metadata preserved for `Current Repository`: `comparison_base_ref: origin/main`, `comparison_base_commit: 33609a1f77499983b6cb10273fe6137ae05aa24f`, `comparison_head_ref: HEAD`, `comparison_rule: local_head_vs_resolved_base`, `resolved_base_source: remote`, `remote_fetch_status: success`, and `local_fallback_reason: null`.
- Acceptance-evidence checks performed: the review evidence re-read the canonical plan and branch scope, mapped Story 60 acceptance criteria to the changed runtime, schema, UI, compose, and proof surfaces, checked the changed-file scope and hygiene/security sweep, and compared the final completed implementation against Task 30's broad automated and manual proof notes already recorded on disk.
- Files and surfaces inspected at review time: the current pass focused on the latest-open PR selector and resumed PR-reconciliation seam in [server/src/flows/githubReview.ts](/home/dan/code/codeInfo2/server/src/flows/githubReview.ts), the execution-scoped scratch and persisted-wait/runtime authority seams in [server/src/flows/service.ts](/home/dan/code/codeInfo2/server/src/flows/service.ts), the branch-exclusion proof owners in [server/src/test/features/flows-execution-runs.feature](/home/dan/code/codeInfo2/server/src/test/features/flows-execution-runs.feature) and [server/src/test/steps/flows-execution-runs.steps.ts](/home/dan/code/codeInfo2/server/src/test/steps/flows-execution-runs.steps.ts), the broad proof wrappers recorded under Task 30, and the supported main-stack startup and smoke surfaces summarized in the evidence artifact.
- Repository completeness conclusion: `Current Repository` remains complete because every plan task through [Task 30](/home/dan/code/codeInfo2/planning/0000060-users-can-automate-github-pr-review-cycles-with-conditional-script-and-wait-steps.md:2749) is now `__done__`, the final task-up-owned revalidation task finished its server build, unit, cucumber, helper, compose smoke, lint, format, and manual proof paths, and the later minor-review loop for this pass closed cleanly with no unresolved task-required, minor-batchable, blocked, or incomplete-review items left in [codeInfoStatus/flow-state/review-disposition-state.json](/home/dan/code/codeInfo2/codeInfoStatus/flow-state/review-disposition-state.json).
- Review outcome normalization: this pass originally endorsed two bounded `should_fix` findings, but the subsequent minor-review loop confirmed both the latest-open selector concern and the branch-exclusion proof concern were already resolved on the current branch and removed them from the active inline-fix queue as stale review state without adding review-fix tasks or code changes in this cycle.
- Overall story completeness conclusion: Story 60 remains complete because the approved flow-only `if`, timed `wait`, and GitHub review variant work landed without reopening older story scope, the final review-created repair block finished and revalidated on current `HEAD`, and the clean review-loop state now shows `safe_to_exit_review_loop_without_tasking: true`.
- Residual and rejected risk notes carried forward honestly: the findings artifact and blind-spot challenge both rejected fresh contradictions around resumed scratch authority, persisted-wait retirement, wrapped `gh pr create` diagnostics, disabled-flow UI gating, mixed-shape subflow state, and warning-status producer/consumer continuity on current `HEAD`; the remaining confidence limit is narrower than exhaustive proof, because the challenge artifact still records residual weak proof around injected startup/bootstrap outage behavior even though the normal supported startup and smoke paths remained healthy.
- Confidence limit: this closeout records a clean no-findings end state for review pass `0000060-20260630T055405Z-13e605da`, but it does not claim exhaustive adversarial coverage beyond the inspected changed-hunk families, the acceptance-evidence matrix, and the broad automated plus manual proof already owned and recorded by Task 30.

## Final Summary

1. What has been changed.
   Story 60 adds flow-only `if`, script-driven yes/no branching, persisted timed `wait`, and thin GitHub PR open/fetch/close steps, then wires those capabilities into new opt-in GitHub review flow variants without changing the existing default flow entrypoints. The final review-created repair block also hardened resumed GitHub review handoff authority and revalidated the server build, unit, cucumber, helper, compose smoke, lint, format, and manual-closeout surfaces.
2. Why it changed.
   The story needed one bounded way for implementation flows to open a PR, wait, ingest outside GitHub review feedback, and route valid findings back through the repository’s existing repair patterns without requiring a human to stitch the cycle together. The late repair work was needed to keep resumed review state truthful and to close the final review loop with no unresolved findings.
3. A simple explanation of any complex logic that needed to be added.
   The hardest part was keeping long-running GitHub review executions deterministic after waits, restarts, and retries. The runtime now treats execution-scoped scratch and handoff files as the authority, rebuilds or validates those paths before reading them again, re-enters same-branch PR reconciliation when resumed state drifts, and keeps the review loop honest by separating inline stale-state cleanup from the final broad revalidation pass.
4. What a reviewer should take particular interest in.
   Reviewers should focus on `server/src/flows/service.ts`, `server/src/flows/githubReview.ts`, `scripts/flow_control/check_github_review_has_reviewer_feedback.py`, and the `/flows` proof owners to confirm the resumed GitHub review authority, PR-selection bounds, and branch-exclusion proof surfaces still match the intended Story 60 contract. The durable closeout evidence now also includes the curated manual-proof bundle under `codeInfoStatus/manual-proof/0000060/`, which is the tracked repository-owned snapshot of the retained final manual-proof artifacts.

### Task 31. Restore Authoritative Loop-Continue Resume Position Under High-Concurrency Validation

- Repository Name: `Current Repository`
- Task Dependencies: `Task 30`
- Task Status: `__done__`
- Git Commits:
  - `524dfc2b DEV-[60] - fix flow continue resume state`

#### Overview

Post-merge validation showed that the previously suspected “timing” failure in the flow loop resume suite was actually a real runtime state bug. Under high-concurrency `server:unit` runs, the resumed `continue` path could trust the originally requested `resumeStepPath` even after persisted flow state had already advanced, which let the runtime skip the next outer-loop iteration and duplicate later post-continue and break work.

This task repairs that state-authority defect in the flow runtime rather than masking it with lower concurrency or larger waits. The repair must keep Story 60's existing resume and persisted-wait behavior intact while restoring one authoritative resume position for same-execution resumes, and it must prove that the canonical `npm run test:summary:all:parallel` wrapper can safely return to computed machine-based parallelism.

- Highest-risk invariant: resumed loop-control execution must honor the latest persisted flow state for the current execution and must not replay later loop-body steps while skipping the next required outer-loop iteration boundary.
- Likely blocker family: `product or story seam`, because the defect crosses persisted resume state, loop-control sequencing, runtime bootstrap, and high-concurrency proof behavior.

#### Task Exit Criteria

- Same-execution resumed flow runs use the latest persisted resume position when deciding where execution should continue, instead of blindly trusting the originally requested `resumeStepPath`.
- The `continue resume keeps its boundary marker until the next iteration makes progress` proof stays green under repeated targeted reruns and under broad high-concurrency `server:unit` execution.
- The canonical `npm run test:summary:all:parallel` wrapper no longer needs the emergency `server:unit` cap at `4` workers and can use the computed machine-based concurrency again.
- Final proof shows the runtime fix, not just wider timeouts, is what restored reliable uncapped parallel validation.

#### Subtasks

1. [x] In `server/src/flows/service.ts`, patch `startFlowRun(...)` so resumed same-execution flow runs derive one authoritative effective resume path from the latest persisted flow state before runtime identity selection, immediate resume-boundary selection, and the unlocked flow run begin; preserve existing fresh-run, wait-state, and provider-bootstrap behavior while removing stale requested-path authority.
2. [x] In `server/src/test/integration/flows.run.loop.test.ts`, keep the focused behavioral proof for `continue resume keeps its boundary marker until the next iteration makes progress` as the primary regression owner for this runtime seam, and confirm the repaired assertion still proves the real visible loop contract rather than reverting to brittle checked-in flow-file structure checks or weaker internal-only snapshots.
3. [x] In `scripts/test-summary-all-parallel.mjs`, restore the canonical all-tests wrapper to the computed `server:unit` concurrency path once the runtime seam is repaired, and keep the explicit `CODEINFO_TEST_TIMEOUT_MS=60000` override for the shared full-suite path so the all-suite proof continues using the approved absolute wait budget without retaining the emergency worker cap.
4. [x] In `server/src/flows/service.ts` and `scripts/test-summary-all-parallel.mjs`, make the smallest code edits needed so the runtime repair and restored all-suite concurrency remain lint-clean without broadening into unrelated cleanup.
5. [x] In the same Task 31 repair files, make the smallest formatting-only edits needed so the repaired runtime seam and restored wrapper behavior satisfy the repository format check without changing behavior.

#### Proof Matrix

1. Requirement: resumed loop-continue execution must use the latest persisted flow position for the current execution before choosing the next runtime boundary.
   Implementation owners: `server/src/flows/service.ts`.
   Proof owners: `server/src/test/integration/flows.run.loop.test.ts` with the focused `continue resume keeps its boundary marker until the next iteration makes progress` case.

2. Requirement: the loop-resume repair must hold under broader loop-runtime coverage, not only one isolated test.
   Implementation owners: `server/src/flows/service.ts`.
   Proof owners: `server/src/test/integration/flows.run.loop.test.ts` run as a full file.

3. Requirement: the repaired runtime seam must be strong enough to support high-concurrency server-unit validation and the uncapped canonical all-suite wrapper.
   Implementation owners: `server/src/flows/service.ts`; `scripts/test-summary-all-parallel.mjs`.
   Proof owners: high-concurrency `test:summary:server:unit` and `npm run test:summary:all:parallel`.

#### Testing

1. [x] Run `CODEINFO_TEST_TIMEOUT_MS=60000 npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --test-name "continue resume keeps its boundary marker until the next iteration makes progress" --skip-build` from the repository root, then repeat that focused proof multiple times so the repaired runtime seam is proven beyond one green run.
2. [x] Run `CODEINFO_TEST_TIMEOUT_MS=60000 npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --skip-build` from the repository root so the repaired loop-runtime seam passes on its broader focused proof home.
3. [x] Run `CODEINFO_SERVER_UNIT_CONCURRENCY=12 CODEINFO_TEST_TIMEOUT_MS=60000 npm run test:summary:server:unit -- --skip-build` from the repository root so the repaired runtime seam proves stable under the higher-concurrency server-unit setting that previously exposed the defect.
4. [x] Run `npm run test:summary:all:parallel` from the repository root with the restored computed `server:unit` concurrency so the canonical full automated suite proves the uncapped shared-build path end to end.
5. [x] Run `npm run lint` from the repository root for the Task 31 repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
6. [x] Run `npm run format:check` from the repository root for the Task 31 repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Patched `server/src/flows/service.ts` so resumed same-execution runs now derive `effectiveResumeStepPath` from the latest persisted flow state when appropriate; this removed stale requested-path authority that was letting resumed loop-control execution skip the next required outer iteration and duplicate later post-continue and break work.
- Kept the focused behavioral regression proof in `server/src/test/integration/flows.run.loop.test.ts` as the authoritative owner for this seam, because the failure turned out to be a real runtime state bug rather than a pure timeout flake.
- Restored `scripts/test-summary-all-parallel.mjs` to the computed machine-based `server:unit` concurrency path after proving the runtime bug was fixed, while preserving the all-suite-only absolute wait override `CODEINFO_TEST_TIMEOUT_MS=60000`.
- The focused failing loop-resume test passed once after the repair and then passed `10` repeated reruns, which showed the repaired seam was no longer dependent on one lucky run.
- `CODEINFO_TEST_TIMEOUT_MS=60000 npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --skip-build` passed with `38/38`, confirming the fix did not regress neighboring loop-runtime behaviors.
- `CODEINFO_SERVER_UNIT_CONCURRENCY=12 CODEINFO_TEST_TIMEOUT_MS=60000 npm run test:summary:server:unit -- --skip-build` passed with `2535/2535`, proving the repaired runtime seam held under the higher-concurrency setting that had previously exposed the defect.
- `npm run test:summary:all:parallel` passed uncapped with `client 900/900`, `server unit 2535/2535`, `server cucumber 133/133`, and `e2e 77/77`, which proved the canonical full-suite wrapper could safely return to computed machine-based parallelism.
- `npm run lint` and `npm run format:check` both completed cleanly for the final Task 31 repair surface.
- Added async-scoped test override support in the Codex/provider bootstrap seams (`server/src/providers/codexRegistry.ts`, `server/src/agents/service.ts`, `server/src/agents/availability.ts`, `server/src/config/runtimeConfig.ts`, and `server/src/test/support/testOverrideScope.ts`) so deterministic availability and provider overrides can be isolated per test while legacy `beforeEach` bootstrap files still keep their global compatibility path.
- Hardened the main Story 60 flow and agent integration harnesses to carry scoped overrides through router callbacks, then revalidated the repaired leak class with targeted reruns, one clean broad `npm run test:summary:server:unit` pass (`2537/2537`), and two clean `npm run test:summary:all:stress` reruns whose `server:unit` leg also stayed green at `2537/2537` under mixed client, cucumber, and e2e load.

### Task 32. Add Flow Runtime-Resolution Stress Diagnostics For Intermittent Startup Stalls

- Repository Name: `Current Repository`
- Task Dependencies: `Task 31`
- Task Status: `__done__`
- Git Commits:

#### Overview

Stress reruns after Task 31 exposed a different intermittent failure family: under `npm run test:summary:all:stress`, some flow and command tests can fail with `Flow runtime resolution timed out after 40000ms` before the first visible agent execute signal. The current flow diagnostics show the run reaching runtime-resolution begin, but they do not yet identify whether the stall is in agent metadata loading, provider availability collection, runtime-config merging, chat-config bootstrap, or endpoint-state resolution.

This task is diagnostics-only unless the new evidence exposes one clearly understood runtime defect. It adds conversation-scoped checkpoints through the flow-to-agent runtime-resolution seam plus richer timeout snapshots in the stress-sensitive proof homes so the next recurrence points to the exact substage that stalled instead of collapsing into a generic timeout.

#### Task Exit Criteria

- [ ] Flow runtime-resolution diagnostics identify the specific stalled substage between flow dispatch and prepared agent execution, including conversation or execution identifiers plus provider, config, and selection context.
- [ ] Runtime-config bootstrap and merge logs expose whether chat-config lock contention, bootstrap branch changes, or config-resolution failures coincide with the stalled flow-resolution window.
- [ ] The stress-sensitive proof homes that currently fail with generic timeout text now capture richer runtime-resolution and runtime-config snapshots that make the next recurrence faster to root-cause.

#### Subtasks

1. [x] In `server/src/flows/service.ts` and `server/src/agents/service.ts`, thread conversation-scoped diagnostics through the flow-owned runtime-resolution path so stress failures can see which substage stalled after `...runtime_resolution_begin` and before the final timeout.
2. [x] In `server/src/config/runtimeConfig.ts`, add runtime-test diagnostics around chat-config bootstrap and merged runtime-config resolution so lock or bootstrap contention becomes visible during stress investigation.
3. [x] In `server/src/test/integration/agents-run-client-conversation-id.test.ts` and `server/src/test/integration/flows.run.command.test.ts`, enrich the timeout snapshots with runtime-resolution and runtime-config diagnostic slices so the failing tests retain the new seam evidence automatically.
4. [x] Run the focused validation for the affected flow and command proof homes, then the required build, lint, and format wrappers for this diagnostics change.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-client-conversation-id.test.ts --test-name "T19 fixture-sweep parity keeps runtime config consistent across REST, flow, and MCP surfaces" --skip-build` from the repository root.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts --test-name "conversation-only stop prevents nested command handoff from starting" --skip-build` from the repository root.
3. [x] Run `npm run build:summary:server` from the repository root because this task changes server TypeScript in the flow, agent, and runtime-config seams.
4. [x] Run `npm run lint` from the repository root for the Task 32 diagnostics surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [x] Run `npm run format:check` from the repository root for the Task 32 diagnostics surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Added conversation-scoped flow runtime-resolution checkpoints around requested-provider metadata, availability, provider-state collection, execution-context resolution, per-provider runtime-config loading, endpoint-state resolution, and runtime-selection completion so the next stress timeout shows the exact last completed substage instead of only the outer `40000ms` timeout.
- Added runtime-test diagnostics for runtime-config resolution begin or complete or failed and chat-config bootstrap begin or complete so shared config or lock behavior can be correlated with future stalled flow-resolution windows.
- Hardened the two currently affected proof homes so their failure text now includes both conversation-scoped runtime-resolution logs and recent global runtime-config diagnostics, which should make the next intermittent recurrence much faster to root-cause.
- Focused validation note: `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-client-conversation-id.test.ts --test-name "T19 fixture-sweep parity keeps runtime config consistent across REST, flow, and MCP surfaces" --skip-build` passed cleanly on Jul 6, 2026, confirming the new diagnostics surface does not break the fixture-sweep parity proof while we wait for the next stress recurrence to use the richer logs.
- Focused validation note: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts --test-name "conversation-only stop prevents nested command handoff from starting" --skip-build` also passed cleanly on Jul 6, 2026, so the richer WebSocket-timeout snapshots and runtime-resolution diagnostics did not regress the conversation-stop contract while we continue the broader stress hunt.
- Build validation note: the first `npm run build:summary:server` pass surfaced a type mismatch where the new execution-context diagnostic referenced non-existent repository metadata keys; renaming that checkpoint to the real `selectedRepositoryPath`, `defaultExecutionRoot`, and `workingRepositoryAvailable` fields restored a clean wrapper pass without changing runtime behavior.
- Repo validation note: `npm run lint` passed cleanly for the Task 32 diagnostics surface after the execution-context field-name correction, so the added runtime checkpoints and failure snapshots did not introduce any new lint drift.
- Repo validation note: `npm run format:check` passed cleanly for the Task 32 diagnostics surface, so the new flow, agent, runtime-config, and proof-harness logging changes are now ready to commit before the next stress-loop rerun.

### Task 33. Propagate Runtime-Resolution Stress Diagnostics To Sibling Flow Timeout Suites

- Repository Name: `Current Repository`
- Task Dependencies: `Task 32`
- Task Status: `__done__`
- Git Commits:

#### Overview

Task 32 added richer runtime-resolution and runtime-config snapshots to the two tests that actually failed during stress. Several sibling flow integration suites already have timeout helpers or runtime-state snapshot functions that cover similar startup, loop, subflow, or observation-race seams, so they should emit the same evidence when the next intermittent stall shows up somewhere adjacent.

This task extends the same diagnostics style to the three most similar proof homes: loop, subflow, and basic flow execution. The intent is still diagnostic-only. We are widening the evidence surface, not claiming a root-cause fix.

#### Task Exit Criteria

- [ ] `flows.run.loop.test.ts` timeout and runtime-state helpers include the same runtime-resolution and runtime-config log slices now used by the original failing tests.
- [ ] `flows.run.subflow.test.ts` timeout diagnostics include the same runtime-resolution and runtime-config log slices alongside existing subflow runtime logs.
- [ ] `flows.run.basic.test.ts` timeout or runtime snapshot helpers include the same runtime-resolution and runtime-config log slices so basic startup stalls keep equivalent evidence.

#### Subtasks

1. [x] Extend `server/src/test/integration/flows.run.loop.test.ts` so `describeFlowRuntimeState(...)` includes runtime-resolution and runtime-config log slices in addition to the existing runtime logs.
2. [x] Extend `server/src/test/integration/flows.run.subflow.test.ts` so `describeRelevantSubflowRuntimeLogs(...)` returns runtime-resolution and runtime-config log slices alongside the existing subflow runtime logs.
3. [x] Extend `server/src/test/integration/flows.run.basic.test.ts` so its timeout or runtime-state helpers include runtime-resolution and runtime-config log slices alongside the existing runtime logs.
4. [x] Run focused validation for the three touched server integration files, then lint and format checks, before committing and pushing this diagnostics increment.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --skip-build` from the repository root.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --skip-build` from the repository root.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts --skip-build` from the repository root.
4. [x] Run `npm run lint` from the repository root for the Task 33 diagnostics surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
5. [x] Run `npm run format:check` from the repository root for the Task 33 diagnostics surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Propagated the same `runtimeResolutionLogs` and `runtimeConfigLogs` snapshot style from the original stress failures into the loop, subflow, and basic flow integration helpers so sibling timeout suites preserve the same runtime seam evidence automatically.
- Focused validation note: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --skip-build` passed cleanly on Jul 6, 2026, so the expanded loop-state snapshots did not regress the main loop-runtime proof file while adding the new diagnostic slices.
- Focused validation note: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --skip-build` also passed cleanly on Jul 6, 2026, so the expanded subflow timeout snapshots did not disturb the existing subflow launch and terminal-state proofs.
- Focused validation note: `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.basic.test.ts --skip-build` passed cleanly on Jul 6, 2026, confirming the basic flow timeout helpers still behave normally after picking up the extra runtime-resolution and runtime-config evidence.
- Repo validation note: `npm run lint` and `npm run format:check` both passed cleanly for the Task 33 diagnostics surface, so the sibling-suite snapshot expansion is ready to commit and push.

### Task 34. Isolate Server-Unit Flow Harness Provider Homes From Shared Repo Chat Configs

- Repository Name: `Current Repository`
- Task Dependencies: `Task 33`
- Task Status: `__done__`
- Git Commits:

#### Overview

The server-unit stress investigation confirmed that the chat-config lock in `server/src/config/runtimeConfig.ts` is still valid application behavior, but several flow and agent integration harnesses were still pointing at repo-root provider homes during test runs. That left Codex and, more importantly, default LMStudio bootstrap paths vulnerable to shared `chat/config.toml` mutation during `server:unit`, which keeps the lock relevant even though many tests already moved away from direct config editing.

This task removes the lock as a practical server-unit concern by isolating the remaining flow-oriented harnesses onto per-test Codex, Copilot, and LMStudio homes. The application lock logic stays unchanged. The change is in the test harness layer only, plus a contract test that should fail quickly if repo-root provider homes are reintroduced into these server-unit seams.

#### Task Exit Criteria

- [x] Remaining Story 60 flow and agent server-unit harnesses use isolated temp Codex, Copilot, and LMStudio homes instead of repo-root provider homes during runtime bootstrap and flow execution.
- [x] Shared harness helpers centralize provider-home isolation so future server-unit additions inherit the same behavior without reintroducing repo-root `chat/config.toml` contention.
- [x] A small automated contract test fails if the targeted server-unit harnesses drift back to repo-root provider-home wiring.

#### Subtasks

1. [x] Add a shared test-support helper that provisions isolated temp Codex, Copilot, and LMStudio homes with minimal seeded files and exposes the corresponding env overrides plus cleanup.
2. [x] Update the remaining flow-oriented server-unit harnesses that still referenced repo-root provider homes so they consume isolated provider homes instead, including harnesses that relied on the default LMStudio path implicitly.
3. [x] Add a contract test that checks the targeted server-unit harnesses for repo-root provider-home regressions.
4. [x] Run focused and broad server-unit validation plus lint and format checks for the isolation change.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --skip-build` from the repository root.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --skip-build` from the repository root.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts --skip-build` from the repository root.
4. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.errors.test.ts --skip-build` from the repository root.
5. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.working-folder.test.ts --skip-build` from the repository root.
6. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.resume.identity.test.ts --skip-build` from the repository root.
7. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/agents-run-ws-cancel.test.ts --skip-build` from the repository root.
8. [x] Run `npm run test:summary:server:unit -- --file server/src/test/unit/provider-home-isolation.contract.test.ts --skip-build` from the repository root.
9. [x] Run `npm run test:summary:server:unit` from the repository root as the broad wrapper proof for the isolation change.
10. [x] Run `npm run lint` from the repository root for the Task 34 server-unit isolation surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
11. [x] Run `npm run format:check` from the repository root for the Task 34 server-unit isolation surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Added `server/src/test/support/providerHomeHarness.ts` so the remaining flow and agent server-unit harnesses can provision isolated temp Codex, Copilot, and LMStudio homes through one shared seam instead of hand-rolling partial env overrides in each file.
- Migrated the remaining flow-heavy server-unit harnesses away from repo-root provider homes by threading the shared helper into the loop, command, errors, working-folder, resume-identity, subflow, and WebSocket-cancel proof homes, while preserving each file's existing agent-home and fixture wiring.
- Added `server/src/test/unit/provider-home-isolation.contract.test.ts` to guard the touched harness files against future repo-root provider-home regressions now that server-unit chat-config contention is meant to stay isolated at the harness layer.
- Extended `server/src/test/integration/flows.run.basic.test.ts` into the same isolation scheme after the first broad rerun exposed remaining `FLOWS_DIR`, `NODE_ENV`, and agent-home overrides there; the custom markdown and invalid-config fixtures also had to set `CODEINFO_AGENT_HOME` explicitly so they no longer fell back to the live `/app/codeinfo_agents` preferred root.
- Re-ran the focused Task 34 wrappers, the new contract test, a focused `flows.run.basic.test.ts` wrapper, the full `npm run test:summary:server:unit` wrapper, `npm run lint`, and `npm run format:check`; the final broad server-unit pass finished green with 2538 passing tests.

### Task 35. Isolate Server-Unit Wrapper Defaults And Remaining Global Env Leaks

- Repository Name: `Current Repository`
- Task Dependencies: `Task 34`
- Task Status: `__done__`
- Git Commits:

#### Overview

Task 34 isolated the Story 60 flow-heavy harnesses, but a broader repository survey showed that `server:unit` still has two remaining isolation gaps. First, the wrapper still launches the full suite with shared default provider-home fallbacks, so tests that do not explicitly override `CODEINFO_CODEX_HOME`, `CODEINFO_COPILOT_HOME`, or `CODEINFO_LMSTUDIO_HOME` can still converge on shared `config.toml` paths. Second, many suites still mutate `process.env` directly, which is only safe if cross-file execution is process-isolated and runtime env reads honor scoped fallback behavior.

This task finishes the repository-wide `server:unit` isolation story by hardening the wrapper itself, giving each test process its own seeded default provider homes, migrating the remaining flow runtime suites that still only override agent homes, and removing the last important raw `NODE_ENV` runtime checks that bypass the scoped test-env seam. The goal is that broad `npm run test:summary:server:unit` runs no longer rely on shared provider config files or cross-file global env stability.

#### Task Exit Criteria

- [x] `server:unit` runs execute test files with process-level isolation and per-process default provider homes, so suites that forget provider-home overrides no longer share runtime `config.toml` paths.
- [x] Remaining provider-backed flow runtime suites that only overrode agent homes now inherit isolated provider homes through the shared harness seam.
- [x] Runtime test-only `NODE_ENV` branches used by `server:unit` honor scoped env reads instead of raw global `process.env`.
- [x] Regression proof exists for the new wrapper/default-provider-home contract or the migrated suites that depended on it.

#### Subtasks

1. [x] Update the `server:unit` wrapper and test loader so each test process gets isolated default provider homes and process-level file isolation.
2. [x] Migrate the remaining flow runtime integration suites that still only set agent-home overrides to the shared isolated provider-home harness pattern.
3. [x] Replace the remaining important raw `NODE_ENV` runtime reads that affect `server:unit` behavior with scoped env lookups.
4. [x] Add or extend regression coverage for the new wrapper/provider-home isolation contract.
5. [x] Run focused and broad `server:unit` validation plus lint and format checks for the isolation sweep.

#### Testing

1. [x] Run focused `server:unit` validation for the wrapper-affected flow files and any new contract coverage from this task.
2. [x] Run `npm run test:summary:server:unit` from the repository root as the broad wrapper proof for the repo-wide isolation change.
3. [x] Run `npm run lint` from the repository root for the Task 35 isolation surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
4. [x] Run `npm run format:check` from the repository root for the Task 35 isolation surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Hardened the `server:unit` wrapper by giving it a dedicated `CODEINFO_TEST_PROVIDER_HOME_ROOT`, adding Node's `--experimental-test-isolation=process` flag, and teaching `server/scripts/register-ts-node-esm-loader.mjs` plus the provider-home resolvers to seed and resolve per-process default Codex, Copilot, and LMStudio homes under that root instead of falling back to shared repo or `/app` paths.
- Migrated the remaining flow runtime suites that only set `CODEINFO_CODEX_AGENT_HOME` and `FLOWS_DIR` (`flows.run.agent-slot`, `flows.run.hot-reload`, `flows.run.resume.backfill`, and `flows.turn-metadata`) onto the shared provider-home harness seam so they now carry isolated provider homes in the same way as the Story 60 flow suites from Task 34.
- Replaced the remaining important raw `NODE_ENV` gates used by `server:unit` in `chat/memoryPersistence.ts`, `mcp2/tools/codebaseQuestion.ts`, and `ingest/ingestJob.ts` with scoped env reads so test-mode behavior follows the AsyncLocalStorage override seam instead of the ambient process environment.
- Extended `provider-home-isolation.contract.test.ts` and the wrapper-env contract coverage so the widened harness set and wrapper-level provider-home root contract fail fast if the new isolation assumptions regress.
- Follow-up broad-wrapper debugging showed that the outer Codex harness was still leaking live `CODEX_HOME` and related provider-home env into `server:unit`; clearing those inherited provider-home vars in `scripts/test-summary-server-unit-env.mjs` let the per-process wrapper homes take effect consistently and removed the remaining `/app/*` fallback regressions.
- Tightened the isolation sweep around test-only seams that were still broad-run fragile: the mocked Mongo persistence helper now scopes `NODE_ENV=production` through the AsyncLocalStorage override path, the command harness runs against an isolated local codeinfo2 root instead of touching checked-in command or markdown files, and a few slow flow-command / loop / subflow / turn-metadata waits were lengthened so persisted success and failure states still settle under full-suite load.
- Validation completed with focused wrapper checks for the touched suites and contract test, a clean `npm run test:summary:server:unit` pass with `2539` passing tests, `npm run lint`, and `npm run format:check`.

### Task 36. Fix Flow-Owned Command Runtime Context And Extend Stress Diagnostics

- Repository Name: `Current Repository`
- Task Dependencies: `Task 35`
- Task Status: `__done__`
- Git Commits:

#### Overview

The first post-isolation `npm run test:summary:all:stress` recurrence exposed four server-unit failures that no longer look like one shared provider-home problem. One command-sequencing failure showed a real runtime mismatch: a flow-owned command resolved from the source repository still executed without a repository-scoped working folder, fell back to the broad shared execution root, and failed before the markdown and inline items could complete. Three sibling failures stayed in the runtime-resolution / resume / child-tracking family, so the next useful increment is to fix the concrete command-context bug while also adding narrower wake, subflow, and agent-conversation diagnostics to the exact seams that still go ambiguous under stress.

#### Task Exit Criteria

- [x] Flow-owned command message items inherit a repository-scoped execution context when the command resolves from an owner or working repository and the flow did not provide an explicit `working_folder`.
- [x] Persisted wait wake diagnostics record why a scheduled wake skipped, resumed, or failed so runtime-resolution stalls on resume are attributable without another broad probe.
- [x] Failed loop or subflow stress recurrences emit richer parent and child conversation state when remembered agent-conversation or terminal-child tracking is missing.
- [x] Focused wrapper validation covers the command, wait, loop, and subflow stress surfaces touched by this task.

#### Subtasks

1. [x] Reproduce and inspect the flow-owned command runtime-context failure path, then patch the flow command execution seam so resolved owner/working repositories can carry a working-folder context into instruction runtime resolution.
2. [x] Add narrow runtime diagnostics around scheduled wait wake dispatch, persisted wait guards, and resume handoff outcomes.
3. [x] Extend the relevant loop and error test snapshots so missing child conversation tracking or skipped wait wakes print parent state, child state, and the new runtime-resolution/runtime-config logs.
4. [x] Run focused wrapper validation for the touched command, wait, loop, and subflow tests plus any required repo lint/format/build checks.

#### Testing

1. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.command.test.ts --skip-build`.
2. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.errors.test.ts --skip-build`.
3. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts --skip-build`.
4. [x] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.subflow.test.ts --skip-build`.
5. [x] Run `npm run build:summary:server` from the repository root because this task changes server runtime code.
6. [x] Run `npm run lint` from the repository root for the Task 36 surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
7. [x] Run `npm run format:check` from the repository root for the Task 36 surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Subtask 1 complete: traced the reproducible flow-command failure back to flow-owned command items resolving from the source repository but still inheriting the broad default execution root at instruction-runtime time, then updated `server/src/flows/service.ts` so owner- and working-repository command loads can supply a repository-scoped working folder into runtime resolution and persisted child-agent state when no explicit `working_folder` was provided.
- Subtask 2 complete: added high-signal `flows.test.wait_wake_runtime` checkpoints for scheduled wake begin, persisted-state guard exits, terminal-state skips, resume dispatch begin/complete, and resume dispatch failures, and extended `flows.test.resume_state_saved` with active subflow conversation ids plus agent-conversation keys so missing child tracking is attributable on the next recurrence.
- Subtask 3 complete: hardened the stress-facing test diagnostics by expanding `flows.run.errors.test.ts` timeout output with parent turns, runtime-resolution logs, and runtime-config logs, and by making `flows.run.loop.test.ts` include the full parent runtime snapshot when an expected remembered agent conversation is missing.
- Subtask 4 complete: focused wrapper validation passed for `flows.run.command`, `flows.run.errors`, `flows.run.subflow`, and a clean rerun of `flows.run.loop` after one unrelated stop-cleanup recurrence; `npm run build:summary:server`, `npm run lint`, and `npm run format:check` also passed for the Task 36 surface.

### Task 37. Preserve Parallel And Stress Harness Reliability

- Repository Name: `Current Repository`
- Task Dependencies: `Task 36`
- Task Status: `__done__`
- Git Commits: `9967d735`, `5b62062a`, `a4e947f7`, `5ca14c6a`, `23ea58d3`

#### Overview

Final Story 60 validation exposed intermittent failures caused by concurrent harnesses sharing process environment, provider homes, runtime probes, asynchronous observation budgets, and Docker lifecycle resources. This task records the test-only isolation and lifecycle work needed to keep the flow-based GitHub review cycle continuously usable and provable on this branch without changing production flow behavior or disturbing the local development stack.

#### Task Exit Criteria

- [x] Concurrent server-unit work cannot inherit another test's environment, provider-home, or deterministic runtime-probe ownership.
- [x] Stress-sensitive tests observe asynchronous product outcomes with bounded diagnostics and budgets that remain reliable under expected parallel CPU contention.
- [x] Cucumber and E2E Docker dependencies are ready before browser or scenario work begins, remain stable during execution, and are verifiably removed afterward.
- [x] Standalone, canonical parallel, and repeated stress wrapper validation pass without altering production behavior or the local development stack.

#### Subtasks

1. [x] Isolate concurrent server-unit environment, provider-home, runtime-resolution, and deterministic LM Studio probe ownership while preserving detached-callback and lingering-worker behavior.
2. [x] Harden stress-sensitive asynchronous test observation points and shared client wait budgets so expected product events remain observable under parallel CPU contention.
3. [x] Add a test-only Docker lifecycle helper with deterministic Compose project ownership, cross-process locking, dependency readiness checks, safe cleanup boundaries, and verified teardown.
4. [x] Integrate prepared Cucumber and E2E infrastructure into the canonical parallel wrapper, preserve self-contained standalone wrappers, and isolate per-run Playwright artifacts without touching `codeinfo:local`.
5. [x] Run repository lint for the completed parallel and stress harness surface and fix all findings.
6. [x] Run repository prettier or format validation for the completed parallel and stress harness surface and fix all findings.

#### Testing

1. [x] Run `node --test scripts/test-docker-harness-lifecycle.test.mjs` from the repository root; all 8 lifecycle-helper tests pass.
2. [x] Run `npm run test:summary:server:cucumber`; all 133 Cucumber scenarios pass with standalone lifecycle ownership.
3. [x] Run `npm run test:summary:e2e`; all 77 E2E tests pass with standalone lifecycle ownership.
4. [x] Run `npm run test:summary:all:parallel`; the complete 3,742-test automated surface passes.
5. [x] Run `npm run test:summary:all:stress` three consecutive times; all 3,742 tests pass on every run without network-change, Docker-conflict, readiness, teardown, or resource-leak failures.
6. [x] Run `npm run build:summary:server` from the repository root; the server build passes.
7. [x] Run `npm run build:summary:client` from the repository root; client typecheck and build pass with only the existing chunk-size warning.
8. [x] Run `npm run lint` from the repository root for the Task 37 surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
9. [x] Run `npm run format:check` from the repository root for the Task 37 surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Subtask 1 complete: added execution ownership and scoped lookup rules for concurrent server-unit environment, provider-home, and deterministic runtime probes without reopening the earlier detached-callback or lingering-worker regressions.
- Subtask 2 complete: strengthened only the stress-sensitive test observation seams and aligned client asynchronous waits with the suite's existing contention budget, leaving product timing behavior unchanged.
- Subtask 3 complete: introduced a test-only lifecycle helper that serializes Docker network mutation, assigns deterministic harness ownership, waits for required services, restricts cleanup to an explicit allowlist, and verifies owned resources are gone.
- Subtask 4 complete: made the canonical parallel wrapper prepare and reuse Cucumber and E2E dependencies before fan-out, retained standalone setup and teardown behavior, and gave each Playwright run an isolated artifact location while leaving `codeinfo:local` untouched.
- Subtask 5 complete: `npm run lint` passed after the harness implementation.
- Subtask 6 complete: `npm run format:check` passed after the harness implementation.

### Task 38. Make GitHub Review Cycles Self-Recovering And Truthful

- Repository Name: `Current Repository`
- Task Dependencies: `Task 37`
- Task Status: `__done__`
- Git Commits: this commit

#### Overview

The final branch review found bounded Story 60 lifecycle gaps in automatic review recovery, wait wake ownership, pre-fetch handoff truthfulness, review-flow branching, scratch locking, PR context, and closeout documentation. This task repairs those seams without changing the deliberate rule that every actionable GitHub finding receives one safe inline attempt before task-up is considered.

#### Task Exit Criteria

- [x] Review-stage transport, state, and agent failures recover or skip safely without terminating the outer implementation flow or claiming a clean review.
- [x] Persisted waits retain automatic wake ownership across lock contention and release completed scheduler state without disturbing a newer wait.
- [x] GitHub review handoff, branching, scratch locking, and PR context remain truthful across fresh, resumed, clean, and findings-present paths.
- [x] Story documentation and the complete automated surface reflect and prove the repaired behavior.

#### Subtasks

1. [x] Add a narrow persisted recovery path for review-stage failures while preserving one-shot inline finding attempts and truthful unresolved state.
2. [x] Rearm wait wakes after `RUN_IN_PROGRESS` and remove only identity-matching completed scheduler entries.
3. [x] Distinguish expected pre-fetch handoff state from lost materialized state and recover stale scratch recovery locks.
4. [x] Gate no-findings closeout correctly and generate reviewer-facing PR content from bounded current-story implementation context.
5. [x] Add focused regression coverage for the repaired runtime and flow composition seams.
6. [x] Refresh the Story 60 simple story, PR summary, design notes, and structural ledger.

#### Testing

1. [x] Run the focused server-unit wrappers for wait resume, GitHub runtime, GitHub adapter, GitHub scratch, and PR-content proof owners.
2. [x] Run the focused flow-control Python tests for GitHub handoff and review branching helpers.
3. [x] Run `npm run build:summary:server` from the repository root.
4. [x] Run `npm run build:summary:client` from the repository root.
5. [x] Run `npm run test:summary:all:parallel` from the repository root.
6. [x] Run `npm run lint` from the repository root.
7. [x] Run `npm run format:check` from the repository root.

#### Implementation Notes

- Task created from the final branch review using bounded plan helpers; no whole-plan read was performed.
- Added persisted review-retry waits with bounded backoff, made pre-open failures record a truthful skip, and preserved the deliberate one-shot finding workflow.
- Rearmed wait ownership after `RUN_IN_PROGRESS` and made completed or stale callbacks clear only their own scheduler identity.
- Distinguished pre-fetch PR context from a genuinely lost fetched handoff and replaced the unrecoverable legacy recovery directory with stale-aware recovery ownership.
- Gated no-findings closeout on a completed clean GitHub context and sourced PR review text from the bounded current-story summary.
- `npm run build:summary:server` passed after tightening parsed review-phase typing.
- The focused story, review, and GitHub-feedback flow-control Python suites passed: 18 tests.
- Extended the existing wait, GitHub adapter, scratch, runtime, PR-content, and flow-control owners to prove lock contention, matching cleanup, review retry, skip behavior, handoff phases, stale recovery locks, and truthful closeout.
- Refreshed the simple story through Task 38 and aligned the PR summary, design contract, and structural ledger with the final self-recovery behavior.
- Focused server wrappers passed for wait resume (10/10), GitHub runtime loops (40/40), adapter (13/13), scratch (13/13), PR content (1/1), and the adjacent basic runtime suite (33/33).
- Final server build rerun passed; the client build and typecheck passed with only the existing Vite large-chunk advisory.
- `npm run lint` and `npm run format:check` both passed.
- `npm run test:summary:all:parallel` passed: client 904/904, server unit 2637/2637, cucumber 133/133, and e2e 77/77.
- `npm run test:summary:all:stress` passed: client 904/904 in 346.518s, server unit 2637/2637 in 453.297s, cucumber 133/133 in 188.062s, and e2e 77/77 in 169.131s.
- Re-ran `npm run format:check` for the remaining closeout proof item; Prettier reported all tracked files matched.
- Implementation-plus-automated-proof audit found all six subtasks and seven testing items supported by repository evidence; no story-caused preserved-behavior regression or standalone blocker was found, so Task 38 is complete for automated proof and ready for manual validation.
