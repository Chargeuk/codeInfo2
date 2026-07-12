# Final Task Creation Contract

Use this repository-agnostic contract whenever a task-up command or flow creates, appends, repairs, or executes a final task. Repository-specific commands and suite names must always be discovered from the participating repositories; never hard-code assumptions about languages, package managers, workspace layouts, frameworks, or test tools into this shared contract.

<final_task_shape>

- The current closeout owner must be a dedicated final validation task after all substantive implementation tasks. Do not make the last implementation task double as the final validation task.
- Immediately below the final task's `Subtasks` heading, before any checklist item, add this non-checkbox note: `Final-task repair scope: this task owns whole-story validation. If lint, formatting, or testing exposes a story-caused issue in code implemented by any earlier task, fix it within this final task when practical and rerun the affected checks. Do not reopen an older task solely to own that repair.`
- At creation time, its `Subtasks` section must contain exactly these two responsibilities, expanded only enough to name the repository-supported commands that were actually discovered:
  - `Run the supported lint command and fix issues.`
  - `Run the supported formatting command and fix issues.`
- Do not pre-plan implementation, proof-authoring, documentation, investigation, evidence-retention, review bookkeeping, or test-execution subtasks in the final task. Those belong in earlier substantive tasks, `Testing`, optional `Manual Testing Guidance`, exit criteria, or implementation notes.
- Keep lint and formatting out of the final task's `Testing` section; they are the final task's only two initial subtasks.
- Immediately below the final task's `Testing` heading, before any repository group or checklist item, add this non-checkbox note: `Final-task repair scope: the whole approved story is in scope for failures found by these suites. Fix story-caused issues within this final task when practical, including issues in code delivered by earlier tasks, and rerun every affected full suite. Do not reopen older tasks solely because their implementation is implicated.`
- The final task must remain `Task Status: __to_do__`, use the normal plan format, name one administrative `Repository Name`, name every proof-scope repository, application, service, workspace, package, or component, and depend on all earlier work needed for story closeout.
- Creating or updating the final task does not complete the story or review cycle. The normal implementation and automated-proof loop must still complete its two subtasks and every testing item.

</final_task_shape>

<affected_surface_discovery>

- Build the final validation scope from the whole approved story, not merely from the final task's administrative repository owner or the most recent repair.
- Inspect every story task, repository owner, affected-repository declaration, planned changed file or surface, dependency, shared contract, and review-cycle repair to identify every application, service, workspace, package, component, or other independently testable project that the story edits or affects.
- Re-read each participating repository's current `AGENTS.md` and repository-owned guidance. Then inspect repository-owned manifests, scripts, wrappers, CI configuration, build files, test configuration, and test directories as needed to discover its supported full-suite commands.
- Prefer repository-supported summary or wrapper commands. Do not invent commands, infer a package manager without evidence, or copy commands from another repository.
- When a shared library, package, schema, runtime contract, or common component changes, use repository evidence to identify affected consumers and include the consumers' required full suites when they are part of the story's regression surface.
- Before final proof runs, compare the planned inventory with the actual story-owned changes and add any newly implicated application or component suites to the same final task. Do not silently omit a suite because implementation touched more than tasking originally predicted.
- If the repository evidence cannot identify the supported full-suite command or the affected consumer set honestly, resolve that during tasking or record a real blocker. Do not substitute a targeted command and call it full validation.

</affected_surface_discovery>

<testing_rules>

- `Testing` must list, separately and explicitly, every supported full automated test suite for every application, service, workspace, package, or component in the affected-surface inventory.
- Include every supported test category that exists for an affected surface, such as unit, integration, contract, behavior, component, system, end-to-end, or equivalent repository-defined suites. End-to-end coverage is mandatory whenever an affected application has a supported end-to-end suite.
- Use the full-suite form of each discovered command. Do not add file, test-name, tag, scenario, grep, subset, or other targeting filters to final-task testing.
- Group testing bullets by repository and affected application or component so ownership is unambiguous. Deduplicate only when one documented full-suite wrapper honestly executes every otherwise required suite; name the covered suites in that bullet so coverage remains auditable.
- Do not add unrelated builds, smoke checks, runtime starts, or deployment checks merely because they are available. Include them only when the repository defines them as part of the affected surface's full automated suite or when a separate story requirement makes them mandatory.
- Do not mark the final task complete until all listed full suites pass after the latest story-owned repair that could affect them. Reopen previously completed testing items when later repairs make their results stale.

</testing_rules>

<same_task_repair_rules>

- The whole approved story is in scope for the final task's failure diagnosis and repair. When final validation exposes a story-caused defect, regression, missing proof, or broken story contract, prefer fixing it within this same final task and rerunning every suite made stale by the repair.
- Attempt bounded diagnose-fix-rerun iterations before declaring a blocker. A failure in an unchanged, demonstrably pre-existing, unrelated surface does not authorize widening story scope.
- Straightforward repairs should be performed directly and recorded in `Implementation Notes`; do not create a new numbered task merely to fix a final-validation failure.
- The final task starts with exactly two subtasks. If a discovered story-level failure needs meaningful work that cannot be completed honestly in the current proof pass, the audit or repair path may add a concrete, bounded repair subtask to this same final task, then return through implementation and full-suite proof. This is the narrow runtime exception to the two-initial-subtask rule.
- Create a different numbered task only when keeping the work in the final task would be dishonest because it requires distinct repository implementation ownership, prerequisite sequencing, architectural decomposition, external authority, or an explicitly approved story-scope expansion.

</same_task_repair_rules>

<review_cycle_rules>

- Initial task-up appends one dedicated final validation task after all initial implementation tasks.
- When unresolved task-required review findings create a contiguous block of repair tasks, append one fresh dedicated final revalidation task after that block. Its affected-surface inventory covers the whole story plus every current-cycle review repair, including minor findings already fixed inline.
- Record the serious review task-up final task in `task_up_owned_final_revalidation_task_title`, set `final_revalidation_owned_by_task_up_path` to true, and set `needs_final_minor_fix_revalidation_task` to false so the cycle has one closeout owner.
- The scoped `task_up_review_tasks` command may repair the already-created final task's shape and full-suite inventory, but it must not create a second current-cycle final task.
- The minor-fix-only path creates or updates one final task only when inline minor fixes were made, no unresolved task-required findings, unresolved minor-batchable findings, or incomplete-review blockers remain, and `needs_final_minor_fix_revalidation_task` is true.
- Identify a minor-fix final task by the active `review_cycle_id`, not merely by title or position. If `final_revalidation_owned_by_task_up_path` is true, the minor-fix-only path must be a no-op.

</review_cycle_rules>

<verification_rules>

- Identify the exact current closeout owner and explain whether it was created, reused, updated, or deliberately not created.
- Confirm that the task was initially generated with exactly the two lint and formatting subtasks in that order.
- Confirm that the required non-checkbox final-task repair-scope note appears first in both `Subtasks` and `Testing`, before any checklist items.
- Confirm that its testing inventory names every affected repository and component and every supported full suite, including supported end-to-end suites.
- Confirm that targeted-only commands, duplicate lint or formatting testing items, and speculative repository-specific commands are absent.
- Confirm that exactly one closeout owner exists for the initial task list or active `review_cycle_id`.

</verification_rules>
