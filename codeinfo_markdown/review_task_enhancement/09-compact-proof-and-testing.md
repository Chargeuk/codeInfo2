# Goal

Give selected review-created tasks realistic automated proof and testing without repeating broad wrapper suites on every review-fix task.

<instruction_priority>

- Follow `review_task_enhancement/01-shared-contract.md` and keep the scope limited to the selected review-created `__to_do__` tasks.
- Keep `Testing` automated-only and wrapper-first.
- Prefer targeted task-local proof plus one broad final revalidation task for the whole review-created findings block.
- Compactness must not leave a changed behavior without an honest automated proof path.

</instruction_priority>

<compact_testing_rules>

- Re-read the selected plan from disk before editing.
- For each selected review-created task, name the narrowest repository-supported automated proof that honestly reaches the changed behavior.
- Prefer targeted wrapper options, targeted files, tags, scenarios, or subsets when the repository supports them and they prove the review fix directly.
- Do not duplicate full-suite, broad-wrapper, Compose, Docker, browser, or e2e runs in every selected review-created task when the fresh final revalidation task already runs that broader proof for the review-created block.
- Add broad task-local proof only when the selected task cannot be proved honestly by targeted automation or when the task itself changes a broad wrapper, harness, runtime, or default path.
- When relying on the final revalidation task for broad regression proof, keep the selected task's `Testing` focused on its targeted proof and make sure the final revalidation task explicitly covers the current review-created findings block.
- Keep optional manual-testing-agent, browser, API, or live-runtime follow-up only in `Manual Testing Guidance`.
- Do not add manual testing checklist items or testing steps.
- Do not make subtasks depend on later automated or manual testing output.
- Preserve required lint and formatter or format-check steps when the repository workflow expects them, but do not duplicate broad test suites solely for symmetry with full story tasks.

</compact_testing_rules>

<verification_loop>

- Check that each selected review-created task has enough targeted automated proof to validate its own fix.
- Check that broad regression proof is run once in the fresh final revalidation task when that is the honest shared proof location.
- Check that no task-local testing section repeats broad suites without a reason tied to that task's own change.
- Check that testing remains runnable at the point the task completes.
- Check that proof quality was reduced only in duplication, not in behavioral coverage.

</verification_loop>

<output_contract>

- Update selected review-created tasks directly.
- Keep testing concise, automated-only, and repository-supported.
- Do not invent commands, wrappers, services, ports, or harnesses not supported by repository evidence.

</output_contract>
