# Goal

Re-read the plan after the scoped review-task-up command and keep improving the newly added review-created `__to_do__` tasks until they match the repository's normal high-quality tasking standard.

<instruction_priority>

- Follow `review_task_enhancement/01-shared-contract.md` and keep the scope limited to the selected newly added review-created `__to_do__` tasks.
- Use fresh disk reads and current git state, not conversational memory.
- Treat thin review notes, under-specified subtasks, and under-scoped testing as defects to repair now rather than acceptable output.

</instruction_priority>

<quality_check_rules>

- Re-read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this step.
- Re-open the exact `plan_path` from disk after the scoped review-task-up command has edited it.
- Re-identify the same newly added review-created `__to_do__` tasks that were eligible for the scoped review-task-up command. Keep edits focused on those tasks except for minimal dependency, numbering, cross-reference, or testing-honesty fixes elsewhere in the plan.
- Compare the selected review-created tasks against the story's stronger pre-existing tasks. Review-created tasks should read like normal first-class story tasks, not lightweight review notes.
- If a selected task still has any subtask that would force a junior implementer to infer the real file target, proof owner, order of operations, or stopping rule, rewrite that subtask now.
- If a selected task still has any subtask that depends on future automated or manual proof output, rewrite that subtask now.
- If a selected task writes absolute filesystem paths, usernames, or machine-specific checkout roots into the plan, rewrite that wording now using portable repository-relative or logical locations.
- If a selected task changes back-end behavior in the current repository, require wrapper-first server proof that is at least as strong as the story's normal server-task standard, including server unit plus server cucumber coverage unless the plan itself now makes a narrower automated boundary explicit and honest.
- If a selected task changes front-end or UI behavior in the current repository, require wrapper-first client proof that is at least as strong as the story's normal UI-task standard, including client tests plus automated e2e or browser-proof coverage unless the plan itself now makes a narrower automated boundary explicit and honest.
- If a selected task would benefit from manual-testing-agent browser or runtime checks, express those only in `Manual Testing Guidance`, not as manual testing checklist items.
- If a selected task plans auth bypasses, seeded identities, mocked providers, bypassed 2FA, or similar test-enablement seams in shipped production behavior, rewrite that work so it lives in test-only harnesses, fixtures, support code, or test configuration.
- Do not let the final revalidation task become the excuse for omitting task-local suites that original story tasks of the same kind would normally carry.
- If a selected task still feels materially weaker than the story's earlier well-tasked tasks, continue editing it in this same step until the gap is closed or the task is explicitly rewritten as a bounded diagnostic task with an honest stopping rule.
- Do not allow a selected task to add manual testing checklist items or subtasks that depend on future automated or manual proof output.
- Do not allow a selected task to route automated screenshots or browser artifacts into tracked repository paths; keep them in ignored artifact storage.
- Do not allow the latest `Code Review Findings` section or its review-created tasks to remain inserted into older parts of the plan; they must be normalized into one contiguous appended end-of-file block.
- Do not merge, delete, absorb, or otherwise identity-shift the selected review-created tasks during this scoped quality pass.
- Do not absorb selected work into older pre-existing story tasks.
- Preserve and improve any existing `Addresses Findings` coverage in the selected tasks.
- If the fresh final revalidation task is missing explicit coverage of the current review-created findings block for this `review_pass_id`, add or repair that wording now instead of only preserving what is already there.

</quality_check_rules>

<verification_loop>

- Check that the selected review-created tasks now look comparable in detail and proof quality to the story's earlier strong tasks.
- Check that no selected task still relies on vague verbs such as “fix,” “handle,” or “update tests” without explicit file targets and intended outcomes.
- Check that each selected task now names the relevant wrapper-first suites honestly instead of deferring all broad proof to the final revalidation task.
- Check that each selected task keeps `Testing` automated-only and moves any optional manual-testing-agent scenarios into `Manual Testing Guidance`.
- Check that no selected task still contains manual testing checklist items or subtasks gated on future proof output.
- Check that no selected task still contains absolute filesystem paths or production-owned test bypasses.
- Check that any automated screenshot or browser-artifact path points only to ignored artifact storage.
- Check that the selected review-created task identities remain the same ones chosen by the scoped review-task-up command.
- Check that each selected task still carries clear `Addresses Findings` coverage, and that the fresh final revalidation task explicitly covers the current review-created findings block for this `review_pass_id`.
- Check that the latest `Code Review Findings` section and its review-created tasks now sit in one contiguous end-of-file block with the fresh final revalidation task after them.
- Check that any edits outside the selected tasks were minimal and only to keep the plan executable and truthful.

</verification_loop>

<output_contract>

- Update the plan directly when quality gaps remain.
- Keep the result concise, concrete, and in scope.
- Do not ask questions; keep improving the selected review-created tasks until they are strong enough.

</output_contract>
