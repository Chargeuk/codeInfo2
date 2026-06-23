# Users can automate GitHub PR review cycles with conditional, script, and wait steps

# Acceptance

1. Operators can run a flow that opens a pull request for the current branch, waits for outside review, reads PR review feedback, and either finishes cleanly or loops back into more implementation work.
2. Flow authors can use a dedicated `if` step and a persisted wait step without adding matching support to agent command JSON.
3. Flow authors can drive `if`, `break`, and `continue` decisions with either the existing AI yes-or-no path or a checked-in Python decision script.
4. The automated review loop can skip GitHub review safely when repository-local GitHub credentials are missing, and it reports that outcome as completed with warning instead of pretending a clean review happened.
5. Existing default flow entrypoints keep their current behavior unless an operator intentionally selects one of the new copied GitHub-review flow variants.

# Description

When this story is complete, CodeInfo2 flows will be able to run one bounded external GitHub review cycle without manual stitching. A flow will be able to open a PR, wait for feedback, fetch review comments from other reviewers, decide which comments are valid for the current story, and either stop cleanly or route valid findings back into the existing repair path. This keeps the new automation focused on the flow runtime while preserving the current default workflows unless someone explicitly opts into the new variant.

# Tasks

1. [codeInfo2] - Define new flow step contracts and shared condition evaluation
   - Extend the flow schema and runtime for `if`, timed wait, and shared AI-or-script decision handling.
   - Add proof in the existing flow schema and runtime test files for valid, invalid, and failure-path decisions.

2. [codeInfo2] - Add persisted wait lifecycle and resume reconciliation
   - Persist authored wait state so a paused run resumes automatically after refresh or restart.
   - Add proof for wait resume, cancellation, terminal cleanup, and contradictory persisted state.

3. [codeInfo2] - Add GitHub transport, repository-local token loading, and review scratch ownership
   - Add the thin `gh`-based PR transport, repository `.env.local` token read, and safe review scratch writers.
   - Add proof for token parsing, explicit PR lookup, pagination, subprocess auth scoping, and scratch replacement.

4. [codeInfo2] - Compose the opt-in GitHub review-cycle flow variant and preserve current defaults
   - Copy the existing implementation flow into a new GitHub-review variant and wire in the new PR, wait, and review steps.
   - Add proof that clean cycles stay open, findings close before loopback, stale scratch is replaced, and default entrypoints stay unchanged.

5. [codeInfo2] - Validate the full story and update closeout documentation
   - Reconcile the final implementation against the story acceptance criteria, proof files, and preserved scope boundaries.
   - Update the architecture docs and PR summary, then run the final wrapper-based validation and main-stack smoke path.
