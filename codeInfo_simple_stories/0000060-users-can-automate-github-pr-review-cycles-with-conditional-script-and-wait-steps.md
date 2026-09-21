# Users can automate GitHub PR review cycles with conditional, script, and wait steps

# Acceptance

1. Operators can run an opt-in flow that opens a pull request, waits for external review, reads PR review feedback, and either finishes cleanly or loops back into more implementation work.
2. Flow authors can use a dedicated `if` step, a persisted wait step, and script-driven yes or no decisions without changing agent command JSON.
3. The GitHub review loop can safely skip PR review when repository-local credentials are missing, and it reports that outcome as completed with warning instead of pretending a clean review happened.
4. Paused, resumed, retried, and overlapping review runs keep truthful per-run state so stale review data, stale wait state, or stale branch hints do not leak into the active cycle.
5. Existing default flow entrypoints keep their current behavior unless an operator intentionally selects the copied GitHub-review variant.
6. The final closeout path revalidates the repaired runtime, review, transcript, and supported-stack behavior through the repository's normal automated proof paths.

# Description

When this story is complete, CodeInfo2 will be able to run a bounded external GitHub review cycle as part of its implementation flows. A flow will be able to open a PR, wait for outside feedback, fetch review comments from other reviewers, decide which comments are valid for the active story, and either close out cleanly or route valid issues back into the existing repair process. The later review-created tasks harden that same workflow so restart recovery, warning handling, overlapping runs, scratch ownership, and supported-stack behavior all stay truthful enough for real repository use.

# Tasks

1. [codeInfo2] - Define flow step contracts and shared condition evaluation
   - Extend the flow schema and runtime for `if`, timed wait, and shared AI-or-script decision handling.
   - Add proof in the existing schema and runtime test files for valid, invalid, and failure-path decisions.

2. [codeInfo2] - Add persisted wait lifecycle and resume reconciliation
   - Persist authored wait state so a paused run resumes automatically after refresh or restart.
   - Add proof for wait resume, cancellation, terminal cleanup, and contradictory persisted state.

3. [codeInfo2] - Add GitHub transport, repository-local token loading, and safe review scratch ownership
   - Add the thin `gh`-based PR transport, the worked-repository `.env.local` token read, and safe review scratch writers.
   - Add proof for token parsing, explicit PR lookup, pagination, subprocess auth scoping, and scratch replacement.

4. [codeInfo2] - Compose the opt-in GitHub review-cycle flow variant and preserve current defaults
   - Copy the implementation flow into a new GitHub-review variant and wire in PR, wait, and review steps.
   - Add proof that clean cycles stay open, findings loop back correctly, and existing default entrypoints stay unchanged.

5. [codeInfo2] - Validate the full story and update closeout documentation
   - Reconcile the shipped behavior against the story acceptance criteria and proof surfaces.
   - Update the summary and closeout artifacts, then run the final wrapper-based validation and supported-stack smoke path.

6. [codeInfo2] - Restore wait-resume truthfulness across status, startup, and replay
   - Repair paused and resumed execution state so warning paths, replay paths, and startup recovery keep one truthful status contract.
   - Add focused server proof for resumed identity, replay ordering, and persisted wait recovery.

7. [codeInfo2] - Harden GitHub review base, handoff, and replay authority
   - Repair base-branch selection, handoff validation, and scratch replay authority for the GitHub review runtime.
   - Add focused proof for explicit base authority, safe handoff parsing, and replay consistency.

8. [codeInfo2] - Restore runtime branch authority and direct GitHub review proof
   - Repair runtime branch selection so untaken `if` paths do not block the real branch chosen at execution time.
   - Add direct runtime proof for clean, findings-present, and resumed review branches.

9. [codeInfo2] - Preserve truthful subflow batch stop outcomes
   - Repair batch stop aggregation so parent status only reports a clean stop when child outcomes really support it.
   - Add focused proof for mixed child-stop results instead of relying on adjacent generic cancellation behavior.

10. [codeInfo2] - Revalidate the first review-task repair block
   - Refresh the review summary for the first review-created findings block after Tasks 6 through 9 land.
   - Run the broad wrapper-first validation and supported-stack smoke path for that repair cycle.

11. [codeInfo2] - Restore truthful GitHub runtime failure classification for review open-PR and token loading
   - Repair runtime failure taxonomy so real `gh` and token-loading faults stay hard failures while approved skip cases stay warnings.
   - Add focused proof for both the runtime producer side and the review-loop consumer side.

12. [codeInfo2] - Give GitHub review scratch state per-run ownership instead of story-global overwrite
   - Replace story-global review scratch ownership with a per-run contract for overlapping review cycles.
   - Add focused proof for writer and reader ownership, malformed scratch rejection, and newer-run authority.

13. [codeInfo2] - Revalidate the second review-cycle repair block
   - Refresh the review summary so the second cycle's serious findings and inline minor fixes stay mapped to one final owner.
   - Run the broad wrapper-first validation and supported-stack smoke path for that cycle.

14. [codeInfo2] - Preserve execution-scoped GitHub review identity across resume, fetch, close, and feedback gates
   - Repair the resumed review runtime so each execution keeps its own PR number, scratch selector, and feedback handoff.
   - Add focused proof for overlapping runs, selector precedence, and rejection of foreign review state.

15. [codeInfo2] - Make GitHub stage plan note appends concurrency-safe
   - Repair note writing so overlapping retries or review cycles do not erase each other's skip or failure notes.
   - Add focused proof for overlapping appends and replay-safe note updates.

16. [codeInfo2] - Keep persisted wait recovery authoritative across wake preflight and startup backfill
   - Repair wait recovery so wake-time failures do not drop ownership and startup backfill faults do not crash the server before listen.
   - Add focused proof for degraded startup recovery, wait ownership preservation, and malformed persisted-wait rejection.

17. [codeInfo2] - Revalidate the third review-cycle repair block
   - Refresh the review summary so the remaining serious findings and inline minor fixes stay traced to one final owner.
   - Run the broad wrapper-first validation and supported-stack smoke path for that cycle.

18. [codeInfo2] - Restore supported main-stack reachability for the opt-in GitHub review flow
   - Repair the supported-stack runtime contract so the copied GitHub review flow is reachable on the checked-in main stack.
   - Add focused proof for catalog mounts, agent-home discovery, `/flows` listing, and default launcher behavior.

19. [codeInfo2] - Revalidate the supported-stack reachability repair block
   - Refresh the review summary so the supported-stack finding and related inline fixes stay mapped to one final owner.
   - Run the focused proof, broad wrapper-first regression pass, and supported-stack smoke path for that cycle.

20. [codeInfo2] - Restore supported main-stack review-agent availability for the opt-in review flow
   - Repair the main-stack review-agent catalog contract so the opt-in review flow is selectable when the repository-owned catalog is present.
   - Add focused proof for mounted catalog visibility, selection behavior, and preserved default `/flows` behavior.

21. [codeInfo2] - Bound GitHub review ingest materialization without changing review semantics
   - Repair the unbounded review-ingest path so large review corpora stay capped without changing review meaning.
   - Add focused proof for bounded ingest, preserved ordering, and downstream scratch-reader compatibility.

23. [codeInfo2] - Preserve GitHub open-PR diagnostics and retry latest-open-PR reconciliation after create
   - Repair the open-PR runtime so transient follow-up lookup failures keep their real `gh` diagnostics and retry safely.
   - Add focused proof for preserved warning ordering, aggregated error reporting, and bounded post-create lookup retries.

24. [codeInfo2] - Restore resumed GitHub review authority when scratch handoffs go missing or drift
   - Repair resumed fetch and close behavior so stale PR numbers or foreign handoff paths cannot take over the active execution.
   - Add focused proof for missing-handoff fallback, same-branch authority, and scratch-root containment.

25. [codeInfo2] - Keep persisted wait recovery and fresh-run replay honest across permanent failure paths
   - Repair lifecycle recovery so permanently invalid state is not treated like transient progress and replay stays truthful.
   - Add focused proof for startup recovery classification, fresh-run ownership, and permanent failure handling.

26. [codeInfo2] - Preserve provider-free resumed review warning paths end to end
   - Repair warning-path ordering so provider-free resumed review runs stop as warnings instead of collapsing into generic success.
   - Add focused proof for the server warning path and the `/flows` transcript consumer path.

27. [codeInfo2] - Bound GitHub review fetch materialization to the capped corpus contract
   - Move the capped-corpus rule earlier so transport and in-memory materialization stop growing before full expansion.
   - Add focused proof for bounded fetch behavior, preserved accepted-entry ordering, and authoritative scratch replacement.

28. [codeInfo2] - Revalidate the final review-cycle task-up repair block
   - Refresh the review summary and final proof map for unresolved findings `1`, `2`, `3`, `4`, `5`, `8`, and `9`, plus inline-resolved minor findings `6`, `7`, and `10`.
   - Run the broad wrapper-first validation, supported-stack smoke path, and final review-cycle closeout proof for the current findings block.

29. [codeInfo2] - Restore canonical execution-scoped handoff authority before resumed GitHub review scripts read disk
   - Repair resumed review handoff ownership so only the active execution-scoped scratch file can be forwarded into the reviewer-feedback helper.
   - Add focused proof for foreign-path rejection, malformed canonical-file handling, and the exact resume-to-helper ordering boundary.

30. [codeInfo2] - Revalidate the latest review-created repair block after the handoff-authority fix
   - Refresh the review summary so the newest review pass and cycle still point to one final revalidation owner and one backend-only proof map.
   - Run the compact broad backend proof path for this repair block, including compose build, server wrappers, helper proof, supported-stack smoke, lint, and format.

31. [codeInfo2] - Restore authoritative loop-continue resume position under high-concurrency validation

- Preserve the exact nested loop boundary across continue, resume, and concurrent validation paths.
- Add focused loop-state proof before rerunning the server harness.

32. [codeInfo2] - Add flow runtime-resolution stress diagnostics for intermittent startup stalls

- Record bounded runtime-resolution and expected-next-step evidence when a flow appears stalled.
- Prove the diagnostic path without changing normal flow behavior.

33. [codeInfo2] - Propagate runtime-resolution stress diagnostics to sibling flow timeout suites

- Reuse the same timeout evidence in related flow suites so intermittent failures identify the blocked boundary.
- Re-run the affected flow wrappers under stress.

34. [codeInfo2] - Isolate server-unit flow harness provider homes from shared repository chat configs

- Give flow tests private provider homes so concurrently running suites cannot read or overwrite shared agent state.
- Prove the affected runtime-resolution tests together.

35. [codeInfo2] - Isolate server-unit wrapper defaults and remaining global environment leaks

- Keep wrapper and test environment overrides scoped to their owning test execution.
- Re-run the full server-unit harness to find and repair similar affected tests.

36. [codeInfo2] - Fix flow-owned command runtime context and extend stress diagnostics

- Preserve the worked-repository runtime context for flow-owned commands and expose the same bounded timeout evidence.
- Prove command and stress paths with focused and broad server wrappers.

37. [codeInfo2] - Preserve parallel and stress harness reliability

- Add deterministic stack readiness and shutdown barriers so cucumber and e2e do not inherit changing Docker networks or old harness processes.
- Validate lint, formatting, builds, the full parallel harness, and repeated stress runs.

38. [codeInfo2] - Make GitHub review cycles self-recovering and truthful

- Persist retry ownership for failures after a review PR is active, while recording pre-PR failures as skips that do not stop the outer implementation flow or claim clean review.
- Rearm contested wait wakes, clean only matching scheduler entries, recover stale scratch locks, gate no-findings closeout, and populate PR text from the bounded story summary.
- Prove wait, GitHub runtime, adapter, scratch, branch-gate, PR-content, build, lint, formatting, parallel, and stress surfaces.
