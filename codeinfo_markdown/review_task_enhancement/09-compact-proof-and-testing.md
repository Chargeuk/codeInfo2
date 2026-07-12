# Goal

Give selected review-created tasks realistic automated proof and testing without repeating broad wrapper suites on every review-fix task.

<instruction_priority>

- Follow `"$CODEINFO_ROOT/codeinfo_markdown/review_task_enhancement/01-shared-contract.md"` and keep the scope limited to the selected review-created `__to_do__` tasks.
- Keep `Testing` automated-only and wrapper-first.
- Prefer targeted task-local proof plus one broad final revalidation task for the whole review-created findings block.
- Compactness must not leave a changed behavior without an honest automated proof path.
- Compactness is allowed only when the fresh final revalidation task explicitly owns full relevant regression proof for the whole current review-created findings block.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md` for the final task: one lint and one formatting checklist item per worked-on repository, plus each repository's full build, applicable startup, every relevant full suite, and matching shutdown for the whole story and current review cycle.

</instruction_priority>

<compact_testing_rules>

- Immediately before editing, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, rerun `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking`, and use only its fresh bounded task selection and section content.
- For each selected review-created task, name the narrowest repository-supported automated proof that honestly reaches the changed behavior.
- Prefer targeted wrapper options, targeted files, tags, scenarios, or subsets when the repository supports them and they prove the review fix directly.
- Do not duplicate full-suite, broad-wrapper, Compose, Docker, browser, or e2e runs in every selected review-created task when the fresh final revalidation task already runs that broader proof for the review-created block.
- Add broad task-local proof only when the selected task cannot be proved honestly by targeted automation or when the task itself changes a broad wrapper, harness, runtime, or default path.
- When relying on the final revalidation task for broad regression proof, keep the selected task's `Testing` focused on its targeted proof and make sure the final revalidation task explicitly covers the current review-created findings block.
- The final revalidation task must name every worked-on repository and affected component and separately list each repository's full build, applicable startup, every relevant full automated suite including supported end-to-end suites, and matching shutdown, without targeted filters.
- If the final revalidation task is missing, vague, too narrow, or does not own full relevant regression proof, repair that final task instead of removing broad proof from selected review-created tasks.
- If targeted task-local proof cannot directly reach the review fix, or if the selected task changes wrappers, harnesses, startup paths, default routing, runtime lifecycle, shared state, or cross-repository behavior, add broader task-local proof instead of relying only on final revalidation.
- If the selected task changes env ownership, compose ownership, startup entrypoints, mounted-path mapping, or working-folder routing, do not treat env dumps or contract-shape assertions as enough targeted proof. Keep or add preserved behavior proof for the affected runtime seam.
- Keep optional manual-testing-agent, browser, API, or live-runtime follow-up only in `Manual Testing Guidance`.
- For Playwright MCP screenshots, Manual Testing Guidance should name both steps: capture to the Playwright output directory first, then transfer into the target repository's `codeInfoTmp/manual-testing/<story-number>/<task-number>/` scratch destination, with later closeout responsible for any curated durable story-proof bundle. For final visual revalidation tasks, compact guidance should still make it clear that latest final-task screenshots are the primary durable proof for re-covered visual surfaces and that earlier screenshots remain durable only when uniquely necessary.
- Do not add manual testing checklist items or testing steps.
- Do not make subtasks depend on later automated or manual testing output.
- Preserve required lint and formatter or format-check steps on substantive tasks when the repository workflow expects them. On the dedicated final task, keep exactly one lint and one formatting checklist item per worked-on repository in `Subtasks` and do not duplicate them in `Testing`.

</compact_testing_rules>

<verification_loop>

- Check that each selected review-created task has enough targeted automated proof to validate its own fix.
- Check that broad regression proof is run once in the fresh final revalidation task when that is the honest shared proof location.
- Check that the fresh final revalidation task explicitly owns each worked-on repository's full build, applicable startup, every relevant full suite for every affected component, and matching shutdown for the whole story and current review cycle.
- Check that no task-local testing section repeats broad suites without a reason tied to that task's own change.
- Check that testing remains runnable at the point the task completes.
- Check that proof quality was reduced only in duplication, not in behavioral coverage.
- Check whether any Manual Testing Guidance that mentions Playwright MCP screenshots distinguishes the Playwright output staging path from the final target repository artifact destination.
- Check whether any compacted final visual-proof guidance still makes it clear that the latest final-task screenshots normally own durable closeout proof for the re-covered surfaces.

</verification_loop>

<output_contract>

- Update selected review-created tasks directly.
- Keep testing concise, automated-only, and repository-supported.
- Do not invent commands, wrappers, services, ports, or harnesses not supported by repository evidence.

</output_contract>
