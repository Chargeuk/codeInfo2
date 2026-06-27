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

### Task 9. Preserve Truthful Subflow Batch Stop Outcomes

- Repository Name: `Current Repository`
- Task Dependencies: `Task 2, Task 4`
- Task Status: `__in_progress__`
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

1. [ ] Inspect `server/src/flows/service.ts` and the current subflow stop proof owners, then identify the exact parent batch-stop result seam, the child stop outcomes it currently collapses together, and the downstream parent result contract that must stay truthful after the repair. Keep the fix local to Finding `subflow-batch-stop-status-swallow` instead of widening the broader stop workflow.
2. [ ] Repair the shared subflow batch stop aggregation in `server/src/flows/service.ts` and any meaningful default-path consumer seam so per-child stop outcomes remain visible to the parent result contract and mixed or ineffective stop attempts are not reported as a clean stop.
3. [ ] Update `server/src/test/integration/flows.run.loop.test.ts` so this proof owner covers the parent result contract with one explicit mixed-outcome batch-stop case, including which child stop outcomes count as authoritative for the parent result instead of inferring that contract from adjacent cancellation success behavior. Rename or split any reused loop-stop case whose current title only claims generic stop or cancellation success if it now proves mixed-outcome batch-stop semantics.

#### Testing

1. [ ] Run `npm run test:summary:server:unit -- --file server/src/test/integration/flows.run.loop.test.ts` from the repository root to prove the repaired subflow batch stop aggregation after the change.
2. [ ] Run `npm run lint` from the repository root for this task's changed surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
3. [ ] Run `npm run format:check` from the repository root for this task's changed surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Implementation notes

- Starts empty. Update during implementation with concise notes about what changed, what issues appeared, and what decisions were made.

### Task 10. Revalidate review pass `0000060-20260626T222120Z-3a823780` after review-task repairs

- Repository Name: `Current Repository`
- Task Dependencies: `Task 6, Task 7, Task 8, Task 9`
- Task Status: `__to_do__`
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

1. [ ] Re-read this `Code Review Findings` block, the active review disposition state, and `codeInfoStatus/pr-summaries/0000060-pr-summary.md`, then build an explicit finding-to-proof checklist for Tasks 6 through 9 before the broad wrapper runs start. At minimum, list the focused proof homes for: Task 6 via `server/src/test/integration/flows.run.basic.test.ts`, `server/src/test/integration/flows.run.resume.identity.test.ts`, and `server/src/test/integration/flows.run.resume.backfill.test.ts`; Task 7 via `server/src/test/unit/flows.github-adapter.test.ts`, `server/src/test/unit/flows.github-scratch.test.ts`, and `server/src/test/integration/flows.run.loop.test.ts`; Task 8 via `server/src/test/integration/flows.run.loop.test.ts`, `server/src/test/features/flows-execution-runs.feature`, and `server/src/test/steps/flows-execution-runs.steps.ts`; and Task 9 via `server/src/test/integration/flows.run.loop.test.ts`. Keep the matching broad regression owners tied to the wrapper surfaces in `Testing` instead of inventing extra proof paths.
2. [ ] Refresh `codeInfoStatus/pr-summaries/0000060-pr-summary.md` and the `Implementation notes` sections for Tasks 6 through 10 so they record, for each routed finding cluster, which focused proof owner closed it and which broad wrapper surface guarded the same seam for review pass `0000060-20260626T222120Z-3a823780` and review cycle `0000060-rc-20260627T002941Z-3f3b9d27`.
3. [ ] Confirm that the active review disposition state and this plan's `Code Review Findings` block still name the same `review_cycle_id` and final revalidation owner before any broad wrapper run starts. If those two sources disagree, repair the local review-loop state first instead of claiming clean final validation from mismatched cycle ownership.
4. [ ] Stage the shared baseline checklist for the broad wrapper pass: `docker-compose.yml`, `server/.env` plus `server/.env.local`, the worked-repository namespace under `CODEINFO_HOST_INGEST_DIR`, readiness `http://localhost:5010/health`, browser `http://localhost:5001/flows`, and artifact destination `codeInfoTmp/manual-testing/0000060/10/`. Keep each baseline item tied to the existing wrapper-owned `Testing` rows for compose build, server build, client build, full server unit, full server cucumber, full client, full e2e, and supported main-stack smoke start and stop.
5. [ ] Prepare the final manual-proof guidance and closeout notes so the later manual-testing pass stays aligned with the repaired runtime, scratch, proof-owner, and broad-wrapper contracts without creating a second review-cycle closeout path.

#### Testing

1. [ ] Run `npm run compose:build:summary` from the repository root because the repaired Story 60 review cycle still depends on the supported main-stack Docker build path, and this repository's automated build contract prefers the compose summary wrapper for container builds.
2. [ ] Run `npm run build:summary:server` from the repository root because the review-created tasks change shared server flow schema, runtime orchestration, persisted wait handling, and GitHub review transport.
3. [ ] Run `npm run build:summary:client` from the repository root to prove the repaired Story 60 branch still leaves the supported browser-visible `/flows` surface buildable after the runtime and proof-owner repairs.
4. [ ] Run full `npm run test:summary:server:unit` from the repository root because the review-created tasks change shared flow runtime, GitHub review transport, persisted wait lifecycle, and subflow orchestration seams.
5. [ ] Run full `npm run test:summary:server:cucumber` from the repository root because the review-created tasks change authored flow behavior and the Story 60 runtime proof contract.
6. [ ] Run full `npm run test:summary:client` from the repository root because the repaired Story 60 proof surface still includes the supported operator-visible `/flows` selection path.
7. [ ] Run full `npm run test:summary:e2e` from the repository root because Story 60 still owns the end-to-end flow execution surface after the review-task repairs.
8. [ ] Run `npm run compose:up` from the repository root because the final review-created validation must include a smoke start of the supported main stack after the broad automated suites complete.
9. [ ] Run `npm run compose:down` from the repository root because the previous step started the supported main stack and this final review-created task must leave that baseline stopped again.
10. [ ] Run `npm run lint` from the repository root for the final Story 60 review-task repair surface and fix any issues found, using `npm run lint:fix` before manual cleanup when possible.
11. [ ] Run `npm run format:check` from the repository root for the final Story 60 review-task repair surface and fix any issues found, using `npm run format` before manual cleanup when possible.

#### Manual Testing Guidance

- Reuse the Story 60 main-stack manual proof path from Task 5 after Tasks 6 through 9 land, but keep the retained artifacts scoped to this review cycle's repaired seams: completed-with-warning skip truthfulness, restarted wait recovery, repository-backed resumed flow identity, trustworthy GitHub review-base selection, fresh authoritative review scratch ownership, and the repaired findings-present versus clean-cycle runtime branches.
- Use the supported main stack from `docker-compose.yml`. The expected env ownership remains `server/.env` plus `server/.env.local` for the app stack and a worked repository under the host ingest namespace rooted at `CODEINFO_HOST_INGEST_DIR`; readiness still starts with `http://localhost:5010/health`, and the operator-visible browser surface remains `http://localhost:5001/flows`.
- Save any retained screenshots, logs, exported JSON, or other closeout proof for this review-created validation under `codeInfoTmp/manual-testing/0000060/10/` and do not commit them. If a later durable bundle is promoted, it should still land under `codeInfoStatus/manual-proof/0000060/`.
- If Playwright MCP screenshots are used for the final `/flows` revalidation, treat the Playwright runtime and the app-under-test runtime as separate when they differ. In the local harness flow, screenshots written under `/tmp/playwright-output/0000060/task-10/` inside the Playwright MCP runtime should normally appear on the host under `$CODEINFO_ROOT/playwright-output-local/0000060/task-10/` as staging output, not as the final repository artifact destination. Transfer the needed final-task screenshots from that staging area into `codeInfoTmp/manual-testing/0000060/10/`, treat those latest final-task screenshots as the primary durable visual proof for the re-covered `/flows` surfaces, and keep earlier screenshots only when they remain uniquely necessary. If the runtime handoff JSON is needed to confirm artifact source, fallback runtime, or destination details, inspect that handoff by meaning rather than by exact property names. If transfer is still blocked, record the limitation honestly instead of treating it as a reason to halt the proof loop.

#### Implementation notes

- Starts empty. Update during implementation with concise notes about what changed, what issues appeared, and what decisions were made.
