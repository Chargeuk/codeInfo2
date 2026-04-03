# Goal

Decide whether the current blocker proves that the plan itself is wrong or incomplete, and repair the plan if needed before work continues.

<task>

Read the stored current-plan handoff and use only that scope for this step.
Re-open the exact plan file from disk before deciding whether the blocker changes the plan.
If there is no blocker, or there was a blocker but no plan repair is needed, state that explicitly.
If the blocker proves the plan is wrong or incomplete, repair the story before work continues.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` first.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Re-open the exact relative `plan_path` from disk before deciding whether the blocker changes the plan.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<decision_rules>

If there is or was a blocker, decide whether it reveals any of the following:

- missing prerequisite tasks;
- a task that is too large and must be split;
- a task that assumes a runtime seam, readiness contract, dependency, test harness, environment mapping, or startup contract that does not yet exist;
- a task with testing steps that cannot honestly be run at the point the task is supposed to complete;
- a task that has remained `__in_progress__` across repeated passes without closing its remaining subtasks, showing that it is too broad, too open-ended, too investigative, or insufficiently concrete for the implementation loop;
- later tasks that now require renumbering or reference updates.

</decision_rules>

<blocker_history_rules>

- When repairing the same task again, do not keep appending full-length blocker essays indefinitely.
- Keep the current live blocker or current `**BLOCKING ANSWER**` in full, but compress older same-class blocker history into one concise historical summary note.
- If multiple earlier blocker notes on the same task all describe exhausted attempts of the same diagnostic class, replace them with one short historical note that states:
  - what class of approach was attempted;
  - that it exhausted cleanly or was superseded;
  - why the current blocker or answer is different.
- Preserve exact raw commands, log paths, and external references only for the current blocker state, not in repeated full inline notes for the same task.

</blocker_history_rules>

<repair_rules>

If any of those are true, you MUST repair the story before continuing:

- insert explicit prerequisite tasks when needed;
- narrow or rewrite a blocked task so it depends only on already proven capabilities;
- renumber all downstream tasks;
- update all cross-references, note-file references, prerequisite references, and testing gates;
- make the new subtasks detailed enough for a junior engineer to follow without asking for help;
- ensure each testing section is runnable at the point that task completes and actually proves the intended work;
- write what changed and why inside the task and implementation notes.
- If the blocker exists because repeated implementation passes did not close the remaining subtasks, you MUST repair the task shape before work continues.
- Rewrite, split, or re-own the task so the next implementation pass has a concrete stopping point and does not depend on indefinite narrowing.
- Replace open-ended `keep narrowing until you find the owner` style subtasks with bounded subtasks that have a clear success or blocker threshold.
- If the same task has already been blocker-repaired once and the next bounded strategy also exhausts cleanly, prefer closing that task on its exhausted branch and creating a fresh successor task rather than narrowing the same task in place again.
- Use in-place repair only when the task still has the same concrete owner and the rewrite is minor.
- If a blocker came from manual testing and the manual tester could not identify a concrete next fix, do not return the task to implementation with vague investigative subtasks.
- In that manual-testing blocker case, either:
  - convert the blocker evidence into concrete bounded implementation subtasks with explicit owners and proof steps; or
  - create a bounded diagnostic task with exact files or surfaces to inspect, the exact commands or repro path to use, an explicit stopping threshold, and an explicit exhausted-branch outcome.
- Do not keep or create open-ended subtasks like `investigate X until the cause is found` after manual-testing blocker repair.
- When repairing a blocker that originated from a manual-testing failure, add a separate automated proof-authoring subtask for that failed manual scenario whenever realistic in the affected repository and harness.
- If realistic automated proof is not possible for that manual-testing failure, record that limitation explicitly in the implementation notes instead of silently omitting it.
- Only update the task's `Testing` section when the existing harness-level testing steps would not already run that new proof, and keep any such testing-step additions at the harness or wrapper level only.

If the blocker exists because the current task assumes a missing runtime seam, dependency, readiness surface, test harness, environment mapping, or startup contract, prefer inserting explicit prerequisite tasks over repeatedly retrying the blocked task.

If this step turns the blocker into actionable next work for the current task, you MUST convert the old active blocker note titled exactly `**BLOCKER**` into a historical non-blocking note titled exactly `**RESOLVED ISSUE**` and preserve its details, even when no broader task split or story repair is required. Keep the `**BLOCKING ANSWER**` note as the proof of how the blocker was resolved. Only leave a note titled exactly `**BLOCKER**` in place when the task is still actively blocked after this step.

If this step rewrites, narrows, or re-owns a task in a way that makes all of that task's subtasks and testing steps honestly complete, do not set that task's `Task Status` directly to `__done__`. Leave it as `__in_progress__` so the normal automated-proof audit and manual-testing path can finalize it honestly in the implementation loop, and add an implementation note explaining that planner repair made the task ready for that final completion path.

</repair_rules>

<behavior_rules>

- This step decides plan impact; it does not re-prove the blocker solution from scratch.
- If no story repair is needed, state explicitly why not.
- If the blocker is now answered well enough that coding, automated proof, or manual testing can continue, retire the live `**BLOCKER**` note in this step before the flow returns to the current-task rework loop.
- Do not bypass the normal audit and manual-testing completion path by setting a planner-repaired task directly to `__done__`.
- Do not leave a known plan defect in place once the blocker has proved it.
- Do not leave an old active blocker marker in place when the task is no longer actively blocked after this step.
- Do not return a repeatedly stalled task to the implementation loop unchanged when the blocker evidence shows the task shape itself is the problem.
- Do not let one task accumulate multiple generations of long blocker prose when a fresh successor task would give a cleaner handoff.
- Prefer one concise historical summary plus one current blocker state over repeated full blocker narratives in the same task.
- Do not invent unnecessary extra work; keep repairs aligned to the KISS principle and only add what is required to unblock honest execution.

</behavior_rules>

<git_rules>

- If you make tracked changes, you MUST commit them before finishing this step.
- Do not push in this step.

</git_rules>

<output_contract>

Return a concise summary that includes:

1. whether the blocker required plan repair;
2. what plan changes were made, if any;
3. why those changes were necessary;
4. why no repair was needed, if that was the conclusion.

</output_contract>

<verification_loop>

Before finishing:

- confirm you re-read the plan from disk;
- confirm the blocker's plan impact was judged from current plan state rather than memory;
- confirm any missing prerequisite, task split, renumbering, or testing-gate changes were applied consistently;
- confirm the updated plan is runnable and honest at each task boundary after your edits;
- confirm tracked changes were committed if any were made.

</verification_loop>
