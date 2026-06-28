# Users can automate GitHub PR review cycles with conditional, script, and wait steps

# Acceptance

1. Operators can run a flow that opens a pull request for the current branch, waits for outside review, reads PR review feedback, and either finishes cleanly or loops back into more implementation work.
2. Flow authors can use a dedicated `if` step and a persisted wait step without adding matching support to agent command JSON.
3. Flow authors can drive `if`, `break`, and `continue` decisions with either the existing AI yes-or-no path or a checked-in Python decision script.
4. The automated review loop can skip GitHub review safely when repository-local GitHub credentials are missing, and it reports that outcome as completed with warning instead of pretending a clean review happened.
5. Paused or resumed review runs keep their own truthful state, so restart recovery or overlapping review runs do not silently reuse stale review data.
6. Existing default flow entrypoints keep their current behavior unless an operator intentionally selects one of the new copied GitHub-review flow variants.

# Description

When this story is complete, CodeInfo2 flows will be able to run one bounded external GitHub review cycle without manual stitching. A flow will be able to open a PR, wait for feedback, fetch review comments from other reviewers, decide which comments are valid for the current story, and either stop cleanly or route valid findings back into the existing repair path. The implementation also keeps the review-cycle state truthful across restart, replay, and overlapping runs so the new automation stays safe to use in real repository workflows without changing the existing default flow entrypoints unless someone explicitly opts into the new variant.

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

6. [codeInfo2] - Restore truthful wait-resume status, startup recovery, and replay behavior
   - Repair the persisted wait and replay seams so resumed runs keep the same execution identity and do not publish a clean completion after a warning skip.
   - Add focused server proof for startup recovery, resumed identity, and the ordering between paused state, replay state, and final status publication.

7. [codeInfo2] - Tighten GitHub review base selection, handoff state, and replay authority
   - Repair the GitHub review adapter and scratch-state contract so the runtime keeps one authoritative review base, handoff shape, and replay source.
   - Add focused proof for explicit base-branch authority, safe handoff parsing, fresh review scratch replacement, and resumed replay consistency.

8. [codeInfo2] - Restore runtime branch authority and direct GitHub review proof
   - Repair the flow runtime so untaken `if` branches cannot block the live branch selected at execution time.
   - Update the runtime and authored proof surfaces so clean-cycle, findings-present, and resumed-review branches are proved directly instead of only by flow-shape inspection.

9. [codeInfo2] - Preserve truthful subflow batch-stop outcomes
   - Repair the shared batch-stop aggregation so parent status reflects mixed or ineffective child stop results honestly.
   - Add focused proof for the parent result contract instead of relying on adjacent generic cancellation-success behavior.

10. [codeInfo2] - Revalidate the review-task repairs and close the active review cycle cleanly
    - Refresh the PR summary, proof checklist, and review-cycle closeout notes after Tasks 6 through 9 land.
    - Run the broad wrapper-first validation, smoke the supported stack, and keep final manual-proof guidance aligned with the repaired review-cycle behavior.

11. [codeInfo2] - Restore truthful GitHub runtime failure classification for PR creation and token loading
    - Repair the GitHub runtime contract so real `gh` or `.env.local` faults stay hard failures while approved skip cases remain warnings.
    - Add focused proof for the producer and default review-loop consumer paths that carry those results.

12. [codeInfo2] - Give GitHub review scratch state per-run ownership
    - Replace story-global review scratch ownership with a per-run contract that keeps overlapping runs from reclaiming each other's active review state.
    - Add focused proof for writer and reader ownership, malformed or partial scratch rejection, and older-run versus newer-run interleaving.

13. [codeInfo2] - Revalidate the current review-cycle task-up repairs and final proof bundle
    - Refresh the PR summary and review-cycle checklist so the active findings, inline minor fixes, and final proof owners are all traced in one place.
    - Run the final broad wrapper-first validation, supported stack smoke path, and helper cross-check for the current review cycle.

14. [codeInfo2] - Preserve execution-scoped GitHub review identity after resume
    - Repair the resumed review runtime so fetch, close, and reviewer-feedback checks stay bound to the same execution-scoped PR and scratch handoff.
    - Add focused proof for overlapping runs, stale-versus-live selector precedence, and helper-side rejection of foreign review state.

15. [codeInfo2] - Make GitHub stage plan-note writes concurrency-safe
    - Repair the shared note-writer seam so overlapping retries or review cycles do not erase one another's notes in the same task block.
    - Add focused proof for contradictory overlapping appends and idempotent replay without duplicated notes.

16. [codeInfo2] - Keep persisted wait recovery authoritative during wake and startup recovery
    - Repair the wait lifecycle so wake-time preflight failures do not drop ownership and recoverable startup backfill faults do not crash the server before listen.
    - Add focused proof for degraded startup recovery, wake-time ownership preservation, and malformed persisted-wait rejection.

17. [codeInfo2] - Revalidate the latest review-created findings block before story closeout
    - Refresh the review-cycle summary so the remaining serious findings and already-resolved minor fixes are all mapped to one final proof owner.
    - Run the broad wrapper-first validation, supported stack smoke path, and final helper/runtime cross-check for the active review cycle.

18. [codeInfo2] - Restore supported main-stack reachability for the opt-in GitHub review flow
    - Repair the supported-stack discovery and flow-definition seam so the copied GitHub review variant is runnable when the repository-owned review-agent catalog is present.
    - Add focused proof for catalog mounts, agent-home discovery, `/flows` listing, and the default `/flows` launcher path without changing existing default entrypoints.

19. [codeInfo2] - Revalidate the current review-cycle repairs after the supported-stack fix
    - Refresh the closeout summary so the remaining serious finding and the already-resolved minor `/flows` guard stay traced to one final review-cycle owner.
    - Run the focused proof, broad wrapper-first regression pass, supported stack smoke path, and final closeout checks for the active review cycle.
