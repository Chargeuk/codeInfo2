# Goal

Perform the final tasking audit and synchronize repository ownership before the final simple-story update and command commit.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md"`.
- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md"` and verify the applicable initial-task-up final-task rules explicitly.
- Use fresh disk reads for the final pass.
- Keep the final task list concrete, traceable, and in scope.
- Prefer one coherent commit over many small commits.
  </instruction_priority>

<verification_loop>

- Re-read the active plan from disk before finalizing.
- Check that every Acceptance Criterion, important Description requirement, and explicit Out Of Scope boundary is correctly represented by the final task list.
- Check that each substantive implementation task and subtask names exactly one implementation repository. Allow the dedicated final task to have one administrative `Repository Name` while grouping full-suite testing across every proof-scope repository and affected component.
- Check that the plan's `Additional Repositories` section exactly matches every non-current repository that the final tasks will change.
- Check that no task has drifted beyond the story's intended scope.
- Check that every task is specific enough for a junior developer and does not depend on hidden senior knowledge.
- Check that every subtask is understandable in isolation for a weak, junior, forgetful developer and does not require them to infer missing instructions from elsewhere in the story.
- Check that each task has realistic exit criteria, dependencies, proof steps, and runnable validation.
- Check that no absolute filesystem paths, usernames, or machine-specific checkout roots were written into tasks, subtasks, testing steps, or manual-testing guidance.
- Check that the final validation task proves the whole story rather than only isolated task-level behavior.
- Check that the applicable categories from `"$CODEINFO_ROOT/codeinfo_markdown/shared/review-preemption-checklist.md"` are represented honestly in the final task list or explicitly not applicable.
- Check that `Testing` is automated-only in every task.
- Check that any `Manual Testing Guidance` section is optional, non-blocking, and checkbox-free.
- Check that no subtask depends on future automated or manual proof output.
- Check that no manual testing checklist items remain in `Subtasks` or `Testing`.
- Check that no task plans production-code changes whose only purpose is to disable, bypass, mock, or weaken real production behavior for tests.
- Check that the highest-risk invariants identified during tasking have explicit task and proof ownership, especially ordering-sensitive lifecycle boundaries, producer-consumer contracts, and default-path reachability.
- Check that broad wrapper, Compose, Docker, browser, or runtime proof has a visible task-owned versus shared-baseline ownership boundary.
- Check that manual-testing guidance, when present, is backed by current runtime facts rather than stale assumptions about env, mounted paths, ports, seed/setup, or artifact destinations.
- Check that each task ends with its repository's supported lint and prettier or format-check subtasks in that order, omitting either item when the command does not exist.
- Check that each non-final `Testing` section ends with its repository's supported lint and prettier or format-check steps in that order, omitting unsupported commands. Check that the dedicated final task keeps only each worked-on repository's supported lint and formatting item types in `Subtasks`, omits either unsupported command independently, and repeats every supported command after shutdown at the end of that repository's `Testing` group.
- Identify the exact dedicated final validation task that is the current story closeout owner.
- Check that its initially generated `Subtasks` section contains each worked-on repository's supported lint command followed by its supported formatting command, grouped by repository, with either unsupported command omitted independently and no other pre-planned subtask types.
- Check that `Subtasks` and `Testing` each begin with the required non-checkbox final-task repair-scope note before any checklist item, explicitly allowing story-caused repairs to remain in this task without reopening older tasks solely because their code is implicated.
- Check that its `Testing` groups every worked-on repository separately and lists that repository's discovered full build, applicable startup, every relevant full automated suite including supported end-to-end suites, matching shutdown, supported lint, and supported formatting in that order, omitting unsupported commands and using no targeted filters.
- Check that initial task-up produced exactly one final story closeout owner and that a later review-created tail is allowed to supersede it with one fresh review-cycle final revalidation task rather than rewriting history.
- Check that any task writing manual-testing proof artifacts into `codeInfoTmp/` also adds the required `.gitignore` update when that scratch path was not already ignored.
- Check that any task-level manual-testing proof guidance uses `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and states that those artifacts must not be committed.
- If it has a runnable, browser-visible, or otherwise externally observable manual-proof surface, verify that its `Manual Testing Guidance` includes:
  - required prerequisite services;
  - startup order where relevant;
  - any needed login, seed, or setup path;
  - where credentials or access come from without inlining secrets.
- If `AGENTS.md` or `codeinfo_markdown/repository_information.md` defines repository-specific conditions that allow manual proof to be narrowed or skipped for certain surfaces, verify that the relevant task-level `Manual Testing Guidance` carries those conditions forward whenever that task could realistically hit them.
- Verify that the final task's manual-testing proof guidance still writes task-scoped artifacts to `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and that the story closeout path points durable curated proof at `codeInfoStatus/manual-proof/<story-number>/`.
- Check that any Playwright MCP screenshot guidance explains the staging-and-transfer flow instead of treating `$CODEINFO_ROOT/playwright-output-local` or the Playwright output directory as the final target repository artifact destination.
- Verify that the final task's manual-testing guidance treats its story-wide screenshots as the primary durable closeout proof for the re-covered visual surfaces, while leaving earlier screenshots in durable scope only when they remain uniquely necessary.
- Verify that manual-testing guidance prefers the unmodified human Docker stack whenever repository evidence shows it is runnable, and only falls back to minimal test-only enablement when the normal stack is not enough.
- Check that any planned screenshot or browser-artifact output path points only to ignored artifact storage rather than tracked repository files.
- If `Design Contract Present` is true, verify that:
  - every named design asset is owned by at least one task;
  - every design-driven task has explicit visual invariants or equivalent concrete design obligations;
  - later manual proof includes screenshot-to-design comparison guidance rather than screenshot capture alone;
  - any intentional task-level override of paired design markdown is stated explicitly in the task wording or `Visual Invariants` rather than left implicit;
  - any task that references paired design markdown plus visual design assets such as `*.png` or `*.svg` treats the markdown as canonical only relative to the supporting visual asset;
  - the final task's `Manual Testing Guidance` requests full-story screenshots for every implemented frontend surface that the design assets govern and makes it clear when those latest screenshots are expected to supersede earlier screenshots for the same surfaces;
- Check that no actual secrets, passwords, or tokens were written into the plan.
  </verification_loop>

<final_edit_rules>

- When the active plan already contains tasks, keep substantive finalization edits focused on tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks during finalization except for minimal numbering, dependency, cross-reference, repository-ownership, or testing-honesty fixes required to keep the plan truthful.
- Preserve the standard named planning sections used by this planning system when they are relevant, such as `Feasibility Proof Pass`, `Message Contracts And Storage Shapes`, `Test Harnesses`, `Edge Cases And Failure Modes`, and `Log Or Proof Markers`.
- Add further relevant sections only when they are genuinely helpful for the selected plan.
- If the plan needs a `Task Exit Criteria`, `Task Dependencies`, or similar task-structure sections to support the final task list truthfully, add or update them.
- Remove contradictions, stale repository references, and stale proof steps.
- Do not leave TODO placeholders or open review comments in the task list.
  </final_edit_rules>

<output_contract>

- Report briefly what changed and what was verified, then leave any final commit creation to the dedicated simple-story step that follows this pass.
  </output_contract>
