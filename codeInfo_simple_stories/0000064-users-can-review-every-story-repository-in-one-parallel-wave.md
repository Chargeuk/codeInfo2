# Users can review every story repository in one parallel wave

# Acceptance

1. Reviewers can run the story's review process across every repository included in the plan.
2. Each repository is reviewed in its own isolated working area, so branches and review evidence cannot overwrite one another.
3. Every fast review pass runs the required target reviews and the story-level cross-repository review, with a clear not-applicable result when only one repository is involved.
4. Fast review passes repeat after eligible minor fixes within the agreed limit, then one final slow review runs for each repository target.
5. Review results are checked for the correct repository, branch, story, commit, and comparison base before they influence closeout decisions.
6. Reviewers can cancel and resume a wave without starting duplicate child reviews or losing accumulated findings.
7. Usable findings remain visible when another review is missing or invalid, and incomplete coverage cannot be reported as a clean review.
8. Accepted and ignored review decisions are recorded once with clear source attribution, while existing single-flow review behavior remains compatible.
9. The completed story passes the supported automated suites, runtime validation, lint, and formatting checks.

# Description

This story gives reviewers a consistent way to review every repository that belongs to a story in parallel. It keeps each target's branch and evidence isolated, combines target and cross-repository results into one trustworthy story-level outcome, and preserves useful partial results when a review job cannot complete. The bounded fast and slow phases make review faster and more predictable while ensuring cancellation, resume, findings history, and final closeout remain reliable.

# Tasks

1. [codeInfo2] - Define immutable flow-input and mixed subflow-wave schemas
- Define the input contracts for matrix and single-child review waves.
- Preserve immutable child inputs and compatibility with existing flow contracts.

2. [codeInfo2] - Persist immutable child inputs and implement the generic subflow-wave runtime
- Store explicit child inputs, working-folder bindings, and stable child identities.
- Prove wave execution and resume behavior without changing ordinary subflow behavior.

3. [codeInfo2] - Resolve and snapshot immutable plan-scope review targets
- Create stable target records for every repository in the plan scope.
- Capture each target's branch, commit, comparison base, and working area.

4. [codeInfo2] - Prepare target-scoped review bases and story review-set manifests
- Prepare isolated review bases and a canonical story-level review set.
- Record expected jobs and versioned evidence without replacing newer stable state.

5. [codeInfo2] - Convert all three existing review flows to explicit single-target contracts
- Make the main, Codex, and Open Code Review flows consume one explicit target each.
- Preserve their existing flow compatibility while removing ambient target discovery.

6. [codeInfo2] - Add the concurrent cross-repository review flow
- Run the story-level cross-repository review alongside target reviews when required.
- Return a deterministic not-applicable result for single-repository stories.

7. [codeInfo2] - Validate and aggregate the complete story review wave
- Validate job identity, usability, coverage, and finding sources before aggregation.
- Prevent incomplete or false-clean review outcomes.

8. [codeInfo2] - Cut the story review loop over to the mixed parallel wave
- Connect the production review loop to the mixed fast and slow wave runtime.
- Preserve cancellation, terminal-state handling, and existing review-loop behavior.

9. [codeInfo2] - Add wave observability, compatibility proof, and documentation
- Expose target-aware child titles, progress, and review-wave diagnostics.
- Add compatibility proof for ordinary subflows and the user-visible review surfaces.

10. [codeInfo2] - Run full automated, lint, format, and manual closeout proof
- Validate the complete story through the supported build, test, runtime, lint, and format workflows.
- Record the approved main-stack closeout evidence.

11. [codeInfo2] - Repair wave validation publication and target-pointer identity preservation
- Keep published target pointers aligned with wave and repository identity.
- Prove usable, partial, and invalid target-local review results.

12. [codeInfo2] - Prove the production review loop records validated decisions in the story plan
- Record accepted and ignored decisions only after server-owned validation succeeds.
- Prove the plan-recording and review-loop integration contracts.

13. [codeInfo2] - Merge the bounded two-phase review foundations from main
- Integrate the approved fast/slow review foundations from the main branch.
- Revalidate flow schemas and review control paths after integration.

14. [codeInfo2] - Add phase-aware review-set preparation and validation
- Distinguish fast and slow review phases and their expected coverage.
- Reject stale, partial, or falsely complete phase results.

15. [codeInfo2] - Compose repeated fast repository waves and one slow repository wave
- Run bounded fast passes with the required target and cross-repository jobs.
- Run exactly one target-only slow wave after fast convergence, including cancellation and resume handling.

16. [codeInfo2] - Reconcile wave-aware disposition, cumulative state, prompts, and documentation
- Align disposition state, review prompts, and documentation with two-phase results.
- Preserve cumulative findings and review history across resumed passes.

17. [codeInfo2] - Prove and close out the combined two-phase multi-repository review cycle
- Validate the complete multi-repository review cycle through the supported runtime and automated suites.
- Confirm target isolation, wave counts, cancellation, resume, and closeout behavior.

18. [codeInfo2] - Integrate OpenCode coverage compatibility into repository review waves
- Preserve OpenCode coverage and target identity in repository review waves.
- Add compatibility and full regression proof for the integrated path.

19. [codeInfo2] - Integrate deterministic OpenCode publication with target-scoped review waves
- Publish OpenCode results with deterministic target and repository pointers.
- Prove publication, artifact validation, and plan-host scope handling.

20. [codeInfo2] - Integrate fail-forward validation with repository review waves
- Keep usable review results available when another job fails or is incomplete.
- Prevent fail-forward coverage from becoming a false-clean closeout.

21. [codeInfo2] - Preserve review-source attribution through disposition and plan recording
- Carry every validated review source into finding disposition and plan records.
- Keep repeated review names distinguishable by target where necessary.

22. [codeInfo2] - Persist per-pass minor-fix audit evidence and cumulative escalation state
- Preserve minor-fix audit evidence and escalation history across review passes.
- Keep cancellation and resume idempotent for review state.

23. [codeInfo2] - Generate idempotent completed audit tasks for minor-fix loops
- Create one completed audit record for each non-empty minor-fix loop and pass.
- Record changed findings, files, and executed proof without duplicate audit tasks.

24. [codeInfo2] - Run full closeout proof for review provenance and minor-loop audit tasks
- Revalidate review provenance, audit records, and the full story through supported wrappers.
- Confirm the supported runtime is stopped cleanly after proof.

25. [codeInfo2] - Re-Validate Story Linting
- Reconfirm the final story build, runtime, full-suite, lint, and formatting lifecycle.
- Keep the completed closeout evidence aligned with the supported repository commands.

26. [codeInfo2] - Reconcile the incomplete slow-wave findings handoff before review task-up
- Repair the server-owned review-output handoff and preserve the blocker if the authoritative aggregate cannot reconcile.
- Do not promote artifact-only candidates into product work or change approved Story 64 behavior.

27. [codeInfo2] - Complete Story 64 Review Target Identity Chips
- Show distinct target identity in root and child review rows, including narrow views.
- Preserve existing flow metadata and prove the client-visible target labels.

28. [codeInfo2] - Re-Validate Story 64 After Review Outcome Reconciliation
- Revalidate the whole story and the current review findings block after reconciliation.
- Own the final build, runtime, full-suite, lint, formatting, and closeout proof for the review cycle.

29. [codeInfo2] - Fix linting
- Resolve story-caused lint issues after review reconciliation.
- Re-run the supported lint proof.

30. [codeInfo2] - Record Minor Review Fixes From Pass 0000064-20260719T100027Z-040c43d7f6-0e3d4ebc
- Record the completed inline minor fixes and their changed files.
- Preserve the executed focused proof and review disposition for the pass.

31. [codeInfo2] - Repair Lossless Review-Cycle Execution and Recover Flow F Findings
- Repair review-cycle execution and recover the affected Flow F findings.
- Preserve cancellation, resume, artifact, and disposition behavior through focused proof.

32. [codeInfo2] - Record Minor Review Fixes From Fast Pass 0000064-20260719T113948Z-05ceb47091-c546d0d5
- Record the completed fast-pass minor fixes and changed proof surfaces.
- Keep the audit evidence idempotent and tied to its review pass.

33. [codeInfo2] - Record Minor Review Fixes From Fast Pass 0000064-20260719T121134Z-05ceb47091-bff35412
- Record the completed fast-pass minor fixes and their executed validation.
- Preserve cumulative disposition and review history.

34. [codeInfo2] - Record Review Fixes From Slow Pass 0000064-20260719T135300Z-05ceb47091-43e2cbc8
- Record the slow-pass review fixes and the findings that remain explicitly blocked.
- Keep non-adopted candidates out of product scope.

35. [codeInfo2] - Re-Validate Story 64 After Current Review Coverage Repair
- Revalidate the story after the current review-coverage repair.
- Run the supported build, runtime, full-suite, lint, and formatting closeout lifecycle.

36. [codeInfo2] - Fix linting
- Resolve story-caused lint and formatting issues after review coverage repair.
- Re-run the supported static-quality checks.

37. [codeInfo2] - Record Minor Review Fixes From Pass 0000064-20260719T212516Z-52af6cfac4-32769dc2
- Record the completed inline fixes from the review pass.
- Preserve finding identity, changed files, and focused proof in the audit record.

38. [codeInfo2] - Record Minor Review Fixes From Pass 0000064-20260719T223932Z-95741e5d79-c6e7c46c
- Record the completed inline fixes from the review pass.
- Preserve target identity, artifact evidence, and executed validation.

39. [codeInfo2] - Record Minor Review Fixes From Pass 0000064-20260720T002803Z-00f835bcb0-a40ed56f
- Record the completed inline fixes from the current review pass.
- Preserve source attribution, changed files, and focused proof without creating duplicate tasks.

40. [codeInfo2] - Reconcile Incomplete Review Coverage and Recover Blocked Findings
- Reconcile missing or invalid review artifacts, cross-repository coverage, contract handoff, and blocked findings without changing approved behavior.
- Prepare focused server, script, and Cucumber proof while preserving any blocker that lacks authoritative evidence.

41. [codeInfo2] - Re-Validate Story 64 After Review Pass 0000064-20260720T002803Z-00f835bcb0-a40ed56f
- Revalidate the whole story, Task 40, the current findings block, and all inline fixes from this review cycle.
- Run the final codeInfo2 build, supported runtime, full automated suites, shutdown, lint, and formatting checks.
