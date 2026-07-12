# Goal

Finalize the enhancement pass by verifying that the new review-created tasks were improved to the `task_up2` quality bar without broadening scope or breaking plan execution order.

<instruction_priority>

- Follow the scoped contract from `"$CODEINFO_ROOT/codeinfo_markdown/review_task_enhancement/01-shared-contract.md"`.
- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md"` and verify the review task-up path still has exactly one current-cycle final revalidation owner.
- Treat scope drift or execution-order regressions as failures of this command.
- Keep the final result maintainable: improve the new review-created tasks, do not churn the story.

</instruction_priority>

<finalization_rules>

- After all enhancement edits, read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, rerun `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking`, and use only its fresh bounded task selection and section content for final verification.
- Confirm that each eligible substantive review-created `__to_do__` task now has:
  - concrete subtasks with explicit owning files, seams, or proof artifacts;
  - realistic wrapper-first testing steps;
  - honest proof homes for the acceptance path, meaningful edge cases, and important review hotspot invariants that task owns;
  - wording that a junior implementer can follow without hidden decomposition work.
- Confirm that each eligible review-created task keeps `Testing` automated-only and uses `Manual Testing Guidance` only as optional, non-blocking guidance.
- Confirm that no eligible review-created task still contains manual testing checklist items or subtasks that depend on future automated or manual proof output.
- Confirm that no eligible review-created task still contains absolute filesystem paths, usernames, or machine-specific checkout roots.
- Confirm that any test-enablement seam such as alternate auth, seeded identities, mocked providers, or bypassed 2FA remains test-owned rather than shipped in the production path.
- Confirm that any automated screenshot or browser-artifact path points only to ignored artifact storage.
- Confirm that any Playwright MCP screenshot guidance explains the staging-and-transfer flow instead of treating `$CODEINFO_ROOT/playwright-output-local` or the Playwright output directory as the final target repository artifact destination.
- Confirm that any Playwright MCP artifact guidance for this codeInfo2 local harness workflow says artifacts written under `/tmp/playwright-output/<relative-path>` inside the local Playwright MCP runtime normally appear at `$CODEINFO_ROOT/playwright-output-local/<relative-path>` on the host, treats that host-visible path as staging rather than the final target repository destination, keeps the screenshot-producing runtime distinct from the app-under-test runtime when those differ, avoids depending on exact runtime-handoff JSON property names, and tells the later manual tester to record any transfer limitation honestly rather than treating it as a reason to halt the proof loop.
- Confirm that any review-created final visual proof guidance clearly expects final-task screenshots to serve as the primary durable proof for the re-covered visual surfaces and preserves earlier screenshots only when they remain uniquely necessary.
- Confirm that vague review-task wording such as “investigate,” “fix issue,” or “address review comment” was either rewritten concretely or converted into a bounded diagnostic task with an explicit stopping rule.
- Confirm that prerequisite review-created tasks are ordered and statused so the implementation loop will pick the next real task directly.
- Confirm that the latest `Code Review Findings` section is still at the end of the plan file except for the newly appended review-fix task block and the fresh final revalidation task that follow it.
- Confirm that the new review-created tasks form one contiguous appended block rather than being inserted into older parts of the plan.
- Confirm that the selected review-created task identities were preserved throughout enhancement rather than deleted, absorbed, or renumbered out of scope.
- Confirm that each selected review-created task still carries durable `Addresses Findings` coverage and that the fresh final revalidation task explicitly covers the current review-created findings block and owns full relevant regression proof for every affected repository.
- Confirm that the fresh final revalidation task initially contains exactly the supported lint and formatting subtasks, names every story- and review-affected repository and component, and lists every repository-supported full automated suite for those components, including supported end-to-end suites and no targeted filters.
- Explain whether the current-cycle final revalidation task was created, reused, or repaired, and confirm that the minor-fix-only path will no-op when `final_revalidation_owned_by_task_up_path` is true.
- Confirm that any older-task edits were limited to minimal numbering, dependency, testing-alignment, or cross-reference changes required to keep the plan honest.
- If the enhancement pass reveals that a selected review-created task cannot be made concrete honestly, replace it with a bounded diagnostic task rather than leaving a vague repair task in the plan.

</finalization_rules>

<verification_loop>

- Check that the enhanced tasks now read like the story's original high-quality planned tasks rather than lightweight review notes.
- Check that no older unrelated tasks were rewritten for convenience.
- Check that the final task sequence remains executable in order without hidden blocker prose.
- Check that the plan file now reflects the true next executable work after review.
- Check that no enhanced review-created task still relies on manual testing checklist items or future proof-output dependencies.
- Check that no enhanced review-created task still relies on absolute paths or production-owned test bypasses.
- Check that the selected review-created task identities remain stable from selection through finalization.
- Check that durable finding-to-task coverage remains visible in the plan after enhancement.
- Check that the latest `Code Review Findings` section plus its review-fix tasks and fresh revalidation task now occupy one contiguous end-of-file block.
- Check that compact targeted testing on selected review-created tasks is used only when the fresh final revalidation task owns full relevant regression proof explicitly and concretely.

</verification_loop>

<output_contract>

- Leave the plan updated in place.
- Do not add meta commentary about this command to the story unless the plan itself needs a brief note to explain a bounded diagnostic replacement or dependency correction.

</output_contract>
