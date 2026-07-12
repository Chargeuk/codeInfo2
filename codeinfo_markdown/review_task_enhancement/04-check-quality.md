# Goal

Load the bounded review-created task packet after the scoped review-task-up command and keep improving those `__to_do__` tasks until they match the repository's normal high-quality tasking standard.

<instruction_priority>

- Follow `"$CODEINFO_ROOT/codeinfo_markdown/review_task_enhancement/01-shared-contract.md"` and keep the scope limited to the selected newly added review-created `__to_do__` tasks.
- Use fresh disk reads and current git state, not conversational memory.
- Treat thin review notes, under-specified subtasks, and under-scoped testing as defects to repair now rather than acceptable output.
- Treat over-fragmented subtasks, micro-subtasks, and duplicated broad testing inside selected review-created tasks as defects to repair now.
- If the selected review-created task set itself is over-fragmented across multiple task identities, do not merge, delete, absorb, renumber, or identity-shift those tasks in this pass. Stop and report an upstream packaging defect so review disposition or stored-review repair can regroup the tasks before scoped enhancement continues.
- If any selected review-created task is over-grouped across unrelated repair seams, root causes, contract or lifecycle surfaces, prerequisite chains, or proof stories, do not split, delete, renumber, or identity-shift that task in this pass. Stop and report an upstream packaging defect so review disposition or stored-review repair can split the task before scoped enhancement continues.
- If a selected review-created task changes or implies changing established user-facing behavior that is not explicitly approved by the story or explicitly approved later by the user, treat that as a task-quality defect and repair it now, unless the task is restoring previously approved or preserved behavior that the current story itself regressed.
- Do not strip or weaken restoration work for a story-caused preserved-behavior regression merely because that restoration visibly changes current `HEAD`.
- Do not preserve a scope-expanded review-created task merely because it is already present in the plan.
- If a selected review-created task exists only because a cleaner, more consistent, more provable, or easier-to-implement behavior was preferred over the current product contract, rewrite that task so it preserves current behavior and instead uses read-only observability, test-harness work, or removes the out-of-scope behavior change entirely.
- If the issue is outside the current story scope, remove that behavior change from the task and mention the scope boundary in step output rather than leaving placeholder follow-up wording in the plan.
- Do not use this removal path for restoration work that puts back previously approved or preserved behavior after current-story drift.
- If a selected review-created task attempts to fix a pre-existing bug or awkward workflow that the story does not explicitly require, remove that behavior change from the task unless the user explicitly approved the expansion.

</instruction_priority>

<quality_check_rules>

- Re-read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` after the scoped review-task-up command has edited the plan.
- Do not answer from conversational memory or an earlier snapshot when these files can be re-read from disk now.
- Re-identify the same newly added review-created `__to_do__` tasks that were eligible for the scoped review-task-up command. Keep edits focused on those tasks except for minimal dependency, numbering, cross-reference, or testing-honesty fixes elsewhere in the plan.
- Compare the selected review-created tasks against the story's stronger pre-existing tasks. Review-created tasks should read like normal first-class story tasks, not lightweight review notes.
- Review-created tasks should also read like compact patch tasks for known findings, not miniature full-story task plans.
- If adjacent selected review-created tasks share repository ownership, repair seam, root cause, implementation owner, and proof story, treat that as task-level over-fragmentation. Do not merge, delete, absorb, renumber, or identity-shift those tasks in this pass. Stop and report that the selected review-created task block must be regrouped by review disposition or stored-review repair before scoped enhancement continues.
- If one selected review-created task combines findings only because they share repository ownership or likely implementation owner, treat that as task-level over-grouping. Do not split, delete, renumber, or identity-shift that task in this pass. Stop and report that the selected review-created task block must be split by review disposition or stored-review repair before scoped enhancement continues.
- If a selected task still has any subtask that would force a junior implementer to infer the real file target, proof owner, order of operations, or stopping rule, rewrite that subtask now.
- Treat `Repository Name` as the selected task's implementation owner, not automatically as the only repository whose proof can appear in `Testing`.
- If a selected task still has any subtask that depends on future automated or manual proof output, rewrite that subtask now.
- If a selected task contains several micro-subtasks that touch one coherent patch area or proof file, compact them into one concrete subtask with inline file targets, assertions, and outcomes unless that would hide sequencing, ownership, or proof risk.
- If a selected task writes absolute filesystem paths, usernames, or machine-specific checkout roots into the plan, rewrite that wording now using portable repository-relative or logical locations.
- If a selected task changes back-end behavior in the current repository, require targeted wrapper-first server proof that honestly reaches the review fix, and rely on the fresh final revalidation task for broader server regression proof when that shared proof location is explicit.
- If a selected task changes front-end or UI behavior in the current repository, require targeted wrapper-first client proof that honestly reaches the review fix, and rely on the fresh final revalidation task for broader client or browser regression proof when that shared proof location is explicit.
- If a selected task needs compatibility proof in another repository, keep its implementation ownership single-repository but allow that additional repository to appear in `Testing` or optional `Manual Testing Guidance`.
- Prefer targeted task-local proof plus the fresh final revalidation task for broad regression proof. Do not require every selected review-created task to repeat full broad suites when the final revalidation task honestly covers the current review-created findings block.
- If a selected task would benefit from manual-testing-agent browser or runtime checks, express those only in `Manual Testing Guidance`, not as manual testing checklist items.
- If a selected task plans auth bypasses, seeded identities, mocked providers, bypassed 2FA, or similar test-enablement seams in shipped production behavior, rewrite that work so it lives in test-only harnesses, fixtures, support code, or test configuration.
- Do not let the final revalidation task become the excuse for omitting targeted task-local proof that the selected review-created task needs to prove its own fix.
- If a selected task still feels materially weaker than the story's earlier well-tasked tasks, continue editing it in this same step until the gap is closed or the task is explicitly rewritten as a bounded diagnostic task with an honest stopping rule.
- Do not allow a selected task to add manual testing checklist items or subtasks that depend on future automated or manual proof output.
- Do not allow a selected task to route automated screenshots or browser artifacts into tracked repository paths; keep them in ignored artifact storage.
- Do not allow selected-task Manual Testing Guidance to imply that Playwright MCP saves screenshots directly into the target repository or that `$CODEINFO_ROOT/playwright-output-local` is the final target artifact destination.
- Do not allow selected-task Manual Testing Guidance to leave the host-visible Playwright artifact source ambiguous for this codeInfo2 local harness workflow; repair it so the later manual tester is told that any Playwright MCP artifact saved under `/tmp/playwright-output/<relative-path>` inside the local Playwright MCP runtime will normally appear at `$CODEINFO_ROOT/playwright-output-local/<relative-path>` on the host.
- Do not allow selected-task Manual Testing Guidance to imply that the app-under-test stack automatically owns the screenshot files when the screenshot-producing Playwright runtime may differ.
- Do not allow selected-task Manual Testing Guidance to depend on exact runtime-handoff JSON property names for artifact source, fallback runtime, or destination details; repair the wording so the later manual tester is told to inspect the available JSON for the needed information by meaning.
- Do not allow selected-task Manual Testing Guidance to treat blocked screenshot transfer as a reason to halt the proof pass; repair the wording so the later manual tester records the limitation honestly and continues with the best available evidence.
- Do not allow selected-task Manual Testing Guidance to imply that all screenshots from all tasks should remain part of durable final proof by default; repair it so final-task screenshots are the primary closeout proof for re-covered visual surfaces and earlier screenshots remain durable only when uniquely necessary.
- Do not allow the latest `Code Review Findings` section or its review-created tasks to remain inserted into older parts of the plan; they must be normalized into one contiguous appended end-of-file block.
- Do not merge, delete, absorb, or otherwise identity-shift the selected review-created tasks during this scoped quality pass.
- Do not absorb selected work into older pre-existing story tasks.
- Preserve and improve any existing `Addresses Findings` coverage in the selected tasks.
- Apply detailed subtask-quality rules only to substantive review-fix tasks. For the dedicated final task, preserve only each worked-on repository's supported lint and formatting initial subtask types, omitting either unsupported command independently, as required by `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`.
- If the fresh final revalidation task is missing explicit coverage of the current review-created findings block for this `review_pass_id`, add or repair that wording now instead of only preserving what is already there.
- If the fresh final revalidation task does not list every worked-on repository's full build, applicable startup, every relevant full suite for every affected component, matching shutdown, supported lint, and supported formatting in order, add or repair that inventory now instead of adding duplicated broad proof to every selected review-created task. Omit unsupported lint or formatting commands independently.
- For the fresh final revalidation task, treat `Affected Repositories` as the source of truth for story-wide proof scope and do not flag the task as malformed merely because its `Testing` spans more than one repository.

</quality_check_rules>

<verification_loop>

- Check that the selected review-created tasks now look comparable in detail and proof quality to the story's earlier strong tasks.
- Check that the selected review-created tasks are compact enough to avoid unnecessary token, task, subtask, and testing duplication.
- Check that none of the selected review-created tasks changes established user-facing behavior unless that behavior change is explicitly approved by the story or explicitly approved later by the user, or the task is restoring previously approved or preserved behavior that the current story itself regressed.
- Check that no selected review-created task exists only to make a behavior cleaner, easier to prove, easier to automate, or easier to implement at the cost of widening story scope.
- Check whether task-level over-fragmentation exists across selected review-created task identities. If it does, stop and report an upstream packaging defect instead of compacting around it.
- Check whether task-level over-grouping exists inside any selected review-created task. If it does, stop and report an upstream packaging defect instead of compacting around it.
- Check that no selected task still relies on vague verbs such as “fix,” “handle,” or “update tests” without explicit file targets and intended outcomes.
- Check that each selected task names targeted task-local proof honestly and that any broad wrapper proof deferred to final revalidation is explicitly covered there.
- Check that any broad wrapper proof deferred to final revalidation is owned by a fresh final revalidation task with full relevant regression proof for the current review-created findings block.
- Check that any selected task with cross-repository proof still keeps implementation ownership and subtasks scoped to its single `Repository Name`.
- Check that each selected task keeps `Testing` automated-only and moves any optional manual-testing-agent scenarios into `Manual Testing Guidance`.
- Check that no selected task repeats broad wrapper, full-suite, browser, Compose, or Docker proof without a task-specific reason.
- Check that no selected task still contains manual testing checklist items or subtasks gated on future proof output.
- Check that no selected task still contains absolute filesystem paths or production-owned test bypasses.
- Check that any selected-task Manual Testing Guidance mentioning Playwright MCP screenshots explains capture to Playwright output followed by transfer into the target repository artifact destination.
- Check that any selected final visual-validation task makes it clear which story-owned surfaces its latest screenshots are expected to cover as the primary closeout proof and whether any earlier screenshots remain uniquely necessary.
- Check that any automated screenshot or browser-artifact path points only to ignored artifact storage.
- Check that the selected review-created task identities remain the same ones chosen by the scoped review-task-up command.
- Check that each selected task still carries clear `Addresses Findings` coverage, and that the fresh final revalidation task explicitly covers the current review-created findings block for this `review_pass_id`.
- Check that the fresh final revalidation task's `Testing` clearly groups every affected component by worked-on repository; includes that repository's full build, applicable startup, every supported full suite and end-to-end suite, matching shutdown, supported lint, and supported formatting in order; omits unsupported commands; and contains no targeted filters or duplicate command items within the section.
- Check that the latest `Code Review Findings` section and its review-created tasks now sit in one contiguous end-of-file block with the fresh final revalidation task after them.
- Check that any edits outside the selected tasks were minimal and only to keep the plan executable and truthful.

</verification_loop>

<output_contract>

- Update the plan directly when quality gaps remain.
- Keep the result concise, concrete, and in scope.
- Do not ask questions; keep improving the selected review-created tasks until they are strong enough.

</output_contract>
