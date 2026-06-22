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

The GitHub integration for this story intentionally uses the simplest operational model. The server image may include the `gh` CLI and use a repository-specific fine-grained GitHub token loaded from the `CODEINFO_PR_TOKEN` value in a `.env.local` file in the repository being worked in for GitHub PR API operations. Normal git credentials in the worked repository remain the preferred path for git fetch and push behavior when they are already configured. The PR steps do not act as the currently logged-in browser user, and that is acceptable for this first version. Likewise, the "latest open PR for the branch" lookup rule is intentionally simple for this story: use the latest still-open PR for the current branch by open date, and ignore closed PRs.

If the repository being worked in does not provide the expected `CODEINFO_PR_TOKEN` value in its `.env.local` file, the GitHub PR and external-review path should not execute for that cycle. The flow should record in the plan that external GitHub review was skipped because the repository-specific token was not configured, then continue or complete without treating missing GitHub review comments as implementation feedback.

If the current branch has not yet been pushed, the PR flow should push it automatically to its existing upstream remote so the review loop can continue without human intervention. If that automatic push fails, the flow should not keep guessing about alternate remotes or block forever waiting for help. Instead, it should record in the plan that the PR could not be created, stop the external-review path for that cycle, and complete without treating missing GitHub review comments as implementation feedback.

When GitHub review is skipped for a supported reason such as missing `CODEINFO_PR_TOKEN`, the flow result should not pretend that a full clean external review happened. It should finish as completed with warning so the final status remains truthful: the implementation flow completed, but the optional GitHub review stage did not run for that cycle.

Fetched GitHub review comments should also be kept separate from the existing external-review ingest files. They should be stored as JSON in their own transient GitHub-review scratch file under `codeInfoTmp/reviews/`, plus only the minimum additional persisted state needed for wait/resume and later classification.

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
- The story documents the minimum GitHub permissions needed for open-PR, read-review-comments, and close-PR behavior, and keeps them restricted to that scope.
- The flow reads `CODEINFO_PR_TOKEN` only from the worked repository's `.env.local` file and does not fall back to `.env` in this story.
- If the expected `CODEINFO_PR_TOKEN` value is missing from the worked repository's `.env.local`, the flow skips PR creation and external-review ingestion for that cycle and records a concise plan note explaining why.
- Normal git credentials remain the preferred auth path for branch fetch and push behavior when they are already configured in the worked repository.
- If the current branch is not yet pushed, the PR creation path pushes automatically to the branch's existing upstream remote using the repository's normal git credentials when available.
- If that automatic push or PR creation fails, the flow records a concise plan note explaining that the PR could not be created and that external GitHub review comments were therefore not part of the implementation cycle.
- If PR creation fails, the flow can complete without attempting the GitHub wait or comment-ingestion steps for that cycle.
- If GitHub review is skipped for a supported reason, the flow finishes as completed with warning rather than as a plain clean completion.
- The first-version PR lookup rule is explicit: use the latest open PR for the current branch by open date and ignore closed PRs.
- The first-version implementation does not attempt per-user GitHub execution identity or browser-user impersonation.
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
- The timed wait contract uses positive integer seconds. Zero, negative, fractional, or non-numeric wait values are rejected at flow-definition validation time rather than clamped silently at runtime.
- The direct Python decision path executes a checked-in repository-relative Python entrypoint from the worked repository root, treats missing files, timeouts, non-zero exit codes, malformed JSON, extra top-level keys, or non-`yes`/`no` answers as hard step failures, and does not reinterpret those failures as a decision.
- A blank or whitespace-only `CODEINFO_PR_TOKEN` value in `.env.local` is treated the same as a missing token and therefore triggers the supported completed-with-warning skip path.
- The story documents one minimum fine-grained token permission set for the GitHub PR cycle: repository `Pull requests` permission at write level, because open or close operations require write access while review and review-comment retrieval requires read access.
- Fetched GitHub review comments are written as JSON to a separate transient GitHub-review scratch file under `codeInfoTmp/reviews/` rather than to the existing external-review ingest files, and only the minimal extra persisted state needed for resume and classification is stored alongside that scratch path.
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

## Story Behavior Lock

- The only approved user-facing behavior change in this story is the addition of new flow-only orchestration capabilities plus newly copied opt-in flow-definition variants that can run one external GitHub PR review cycle.
- Existing browser-visible behavior, existing agent-command behavior, existing in-use flow files, and existing default execution paths stay preserved unless an operator intentionally selects one of the new copied variants.
- If the story does not explicitly change a workflow surface, runtime path, review artifact path, or manual-testing path, the current behavior for that area must be preserved.
- Review feedback, proof convenience, or runtime neatness are not reasons to widen the story into broader GitHub platform work, browser UX work, or workflow redesign.

## Message Contracts And Storage Shapes

- Flow-schema additions stay within the existing flow step family in `server/src/flows/flowSchema.ts`; this story does not add matching schema items to agent-command JSON.
- The new `if` step owns one explicit condition plus `then` steps and optional `else` steps. It must not hide extra implicit branching inside the GitHub step implementations.
- The direct Python decision path follows the repository's existing `scripts/flow_control/*.py` wrapper style: a checked-in repository-relative Python entrypoint runs from the worked repository root and prints exactly `{\"answer\":\"yes\"}` or `{\"answer\":\"no\"}` to stdout with no alternate success shape.
- The timed wait step persists enough state to resume safely after restart, including the current execution identity, the next step location, the resume timestamp, and any loop context needed to continue the same flow run rather than launching a fresh run.
- GitHub review scratch state lives in `codeInfoTmp/reviews/<story-number>-current-review.json` as transient workflow state. At minimum it must identify the canonical `plan_path`, the active repository alias or root, the branch or HEAD being reviewed, the selected open PR identity, the raw fetched review artifact path, and any supported skip or failure reason that caused a completed-with-warning outcome.
- The fetch step stores raw GitHub review data in a separate JSON scratch artifact under `codeInfoTmp/reviews/`. Classification and later review-disposition work read that scratch state rather than reusing the existing external-review input markdown path.
- Plan notes remain the durable source for supported skip or failure explanations in this story. Scratch review JSON is transient workflow state and must not become the only durable record of why external review was skipped.

## Edge Cases And Failure Modes

- If `.env.local` is missing, unreadable, lacks `CODEINFO_PR_TOKEN`, or contains only blank or whitespace for that variable, the flow records a concise plan note, skips the GitHub review cycle for that pass, and finishes as completed with warning.
- If the current branch does not already have a usable upstream remote, or the automatic push fails, the flow records a concise plan note, does not guess alternate remotes or forks, and skips the GitHub review cycle for that pass with completed-with-warning status.
- If multiple open PRs exist for the same branch, the flow selects the newest still-open PR for that branch by open time and ignores closed PRs.
- If the fetch or close step cannot identify any open PR for the current branch, it must fail or skip in a way that does not mutate an unrelated PR on another branch.
- Review ingestion must ignore PR-author-authored review submissions and inline comments so the GitHub review cycle only classifies outside feedback from other users.
- Malformed or partially written GitHub-review scratch JSON must not be treated as an empty clean review. Reader steps should fail clearly or trigger a supported rerun path rather than silently downgrading the evidence.
- The timed wait step must remain safe across restart and cancellation boundaries: resumed execution continues the same flow run, while cancelled or terminal runs do not wake up later and keep mutating state after the run is already over.

## Implementation Ideas

- Extend `server/src/flows/flowSchema.ts` and the flow dispatcher in `server/src/flows/service.ts` with one coherent flow-only step family for `if`, timed wait, and thin GitHub PR actions, while leaving agent-command JSON unchanged.
- Refactor the existing `break` and `continue` runtime so AI decisions and repository-relative Python wrapper-script decisions share one strict yes-or-no parsing, timeout, and failure contract.
- Persist timed wait state through the existing flow resume machinery so one run can pause, survive refresh or restart, and resume automatically at the right step without creating a second run.
- Add a thin GitHub adapter that reads repository owner, branch, head commit, and `.env.local` token configuration from the worked repository, pushes only to the existing upstream remote when needed, and records supported skip or failure outcomes as completed-with-warning rather than guessing remotes or forking behavior.
- Generate reviewer-facing PR title and body content from the current story and implementation context using the repository's existing reviewer-summary conventions, including the no-out-of-scope-behavior-change rule.
- Persist fetched GitHub review data under `codeInfoTmp/reviews/` as transient GitHub-review scratch state that later classification, minor-fix, and task-up routing can consume without reusing the existing external-review input markdown path.
- Keep the first practical workflow wiring opt-in by copying and renaming the existing in-use flow definitions before composing the new review-cycle loop into those new variants.
- Route actionable GitHub review findings back through the repository's existing minor-fix and task-up repair patterns instead of introducing a second competing findings lifecycle.
- Add focused proof for schema parsing, strict decision-script handling, persisted wait or resume behavior, supported skip paths, GitHub PR open or fetch or close wiring, latest-open-PR branch selection, review-author filtering, and both clean-cycle and more-work-needed flow compositions.

## Questions

- No Further Questions
