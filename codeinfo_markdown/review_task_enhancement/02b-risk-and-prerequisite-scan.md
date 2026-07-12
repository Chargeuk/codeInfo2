# Goal

Scan the selected review-created tasks for high-risk invariants, missing prerequisites, and recurring blocker families before the reused `task_up` quality passes reshape them.

<instruction_priority>

- Follow the scoped contract from `"$CODEINFO_ROOT/codeinfo_markdown/review_task_enhancement/01-shared-contract.md"`.
- Apply this pass only to the eligible review-created `__to_do__` tasks selected by `"$CODEINFO_ROOT/codeinfo_markdown/review_task_enhancement/02-select-scope.md"`.
- Use fresh disk reads and current git state, not conversational memory.
- Do not retask the whole story or broaden scope to older unrelated tasks.
- Treat missing risk ownership as a tasking defect to repair before subtask granularity and proof-matrix passes run.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Keep risk and prerequisite implementation work on substantive review tasks; for the dedicated final task, update only its worked-on repository, build, runtime, and full-suite inventory while preserving per-repository lint and formatting as its only initial subtask types.

</instruction_priority>

<risk_scan_rules>

- Immediately before editing, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, rerun `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking`, and use only its fresh bounded task selection and section content.
- Keep the selected review-created task identities stable. Do not delete, absorb, merge away, split, repackage, or renumber selected tasks in a way that changes which tasks are in scope for later enhancement passes. Only make minimal ordering or dependency repairs that preserve selected task identity.
- For each selected substantive task that touches lifecycle, persistence, cross-contract behavior, default-entrypoint behavior, runtime proof, or broad wrappers, identify the highest-risk invariant that could still fail after a happy-path proof.
- When a selected task changes create, admission, waiting, running, success, no-op, error, cancel, retry, cleanup, startup recovery, or dependency-outage behavior, ensure the task owns an exact ordering or interleaving proof when adjacent before/after proof would not prove the real invariant.
- When a selected task changes shared errors, payloads, persisted shapes, log markers, schema, OpenAPI, documentation-visible contracts, transport wrappers, or response construction, ensure the task names the producer, each meaningful consumer, and the proof home for propagation through the default or wrapper path when caller-visible behavior depends on it.
- When a selected task changes selectors, launchers, wrappers, startup paths, CI routing, feature flags, harness registration, or default commands, ensure it proves the changed behavior is reachable through the normal default path rather than only a targeted or manual route.
- When a selected task relies on broad wrappers, Compose, Docker, browser runtimes, generated images, shared ports, long-running services, or manual/live-runtime validation, ensure the task distinguishes task-owned proof from shared baseline, harness, runtime-handoff, or environment ownership.
- When later manual or runtime validation is likely, ensure the selected task or its final manual guidance names the supported stack, env files, mounted path namespace, ports, readiness checks, seed/setup source, and artifact destination. If those facts are unknown, add prerequisite ownership rather than leaving the manual tester to discover them by failure.
- When a selected task changes env ownership, compose ownership, entrypoint assumptions, mounted-path mapping, or working-folder routing, ensure it records the current reproduced defect and the exact preserved behavior that must survive the repair. Do not let portability cleanup stand in for that runtime justification.
- If a selected review-created task assumes a missing prerequisite, preserve the selected task's identity and add or move only the prerequisite owner needed to make execution honest. Keep older task edits limited to dependency, status, numbering, or cross-reference fixes required by that prerequisite. If satisfying the prerequisite would require splitting, deleting, absorbing, renumbering, or identity-shifting selected review-created tasks, stop and report an upstream packaging defect instead of repackaging the selected task set.
- If a selected review-created task is too broad, vague, or investigative to execute, rewrite it into bounded implementation or diagnostic work with exact files, surfaces, stopping rules, and exhausted-branch outcomes.

</risk_scan_rules>

<blocker_family_rules>

- Classify likely blocker exposure for each selected task as one of: product or story seam; proof or test harness seam; shared wrapper or baseline seam; manual or runtime environment seam; task-shape or planning seam.
- Product or story seam risks may stay on the selected task when the task owns the implementation and proof.
- Proof or test harness seam risks need explicit harness proof ownership before downstream product work relies on them.
- Shared wrapper or baseline seam risks need prerequisite baseline ownership instead of repeated broad-wrapper retries inside downstream tasks.
- Manual or runtime environment seam risks need runtime-handoff ownership before manual proof depends on env, mounts, ports, readiness, seed/setup, or artifact paths.
- Task-shape or planning seam risks need bounded task rewriting before implementation resumes.

</blocker_family_rules>

<section_ownership_rules>

- Put implementation, proof-authoring, documentation, config, harness, and prerequisite ownership in substantive tasks' `Subtasks`, never in the dedicated final task.
- Keep `Testing` automated-only and wrapper-first.
- Put optional browser, API, or manual-testing-agent follow-up only in `Manual Testing Guidance`.
- Do not create manual-testing subtasks or testing checklist items.
- Do not create subtasks that depend on future automated or manual proof output.
- Do not create vague tasks such as `investigate`, `confirm`, `figure out`, or `fix review issue` unless they are converted into bounded diagnostic work with an explicit stopping rule.

</section_ownership_rules>

<verification_loop>

- Check that every selected review-created task has explicit ownership for its highest-risk invariant or an explicit statement that the invariant is not applicable.
- Check that no exact ordering, interleaving, producer-consumer, default-path, baseline, harness, or runtime-handoff risk is deferred to later review without a task or proof home.
- Check that any prerequisite introduced by this pass becomes executable before the task that depends on it.
- Check that the selected review-created task block remains scoped, contiguous where possible, and faithful to the latest review findings.
- Check that older tasks were not rewritten except for minimal dependency, status, numbering, or cross-reference repair.

</verification_loop>

<output_contract>

- Update the selected review-created tasks directly.
- Keep edits scoped, concrete, and executable.
- Do not add meta commentary about this pass to the plan unless a brief implementation note is needed to explain a prerequisite, bounded diagnostic replacement, or dependency correction.

</output_contract>
