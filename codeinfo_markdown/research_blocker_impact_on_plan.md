# Goal

Decide whether the current blocker proves that the plan itself is wrong or incomplete, and repair the plan if needed before work continues.

<task>

Read the stored current-plan handoff and use only that scope for this step.
Use the same current-task context and blocker-owner conclusion from the immediately preceding blocker-solution step rather than re-reading `current-task.json` again in this same planning-agent pass.
Load fresh bounded blocker and story-scope packets before deciding whether the blocker changes the plan.
Read the selected task's latest `**BLOCKING ANSWER**` from the bounded blocker-repair packet and extract any blocker-family and ownership conclusion before deciding whether to repair the plan.
If there is no blocker, or there was a blocker but no plan repair is needed, state that explicitly.
If the blocker proves the plan is wrong or incomplete, repair the story before work continues.
If the blocker is an external reviewer, provider, runtime, or terminal-artifact dependency and the same condition still exists, preserve the parser-visible `**BLOCKER**` line. Documenting ownership or a retry path does not resolve that blocker. Do not convert it to `**RESOLVED ISSUE**` unless fresh repository evidence shows the external condition changed or the required terminal artifact now exists.

</task>

<scope_rules>

- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`.
- Use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Do not rediscover the story independently.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile blocker-repair --task current` and `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile story-scope` before deciding whether the blocker changes the plan.
- Use fresh disk reads and current git state, not conversational memory.

</scope_rules>

<blocker_detection_rules>

- Before deciding whether the current blocker changes the plan, read `$CODEINFO_ROOT/codeinfo_markdown/shared/blocker-detection.md`.
- If the immediately preceding blocker-solution step clearly resolved a bound task, use that same task number here and run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <that-number>`.
- If the immediately preceding blocker-solution step instead concluded that plan repair is still needed and did not clearly resolve one task, use that repair-needed state as the primary context for this step and fall back to the current repaired plan on disk only to determine whether one blocker owner is now visible.
- Only when that fallback is necessary may you run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --selector active_or_done`.
- Use the parser output, not visual scanning, to determine whether the selected task contains any live blocker lines.
- Treat only lines reported by the parser under `selected_task.live_blockers` as the current live blocker state for this step.
- If you retire, preserve, or rewrite a live blocker during this step, rerun the parser before finalizing your answer so blocker state and task status match current disk state.

</blocker_detection_rules>

<blocker_family_rehydration_rules>

- In the bounded blocker-repair packet, find the selected task's latest `**BLOCKING ANSWER**` implementation note when one exists.
- Extract these conclusions from that note before applying decision or handoff rules:
  - blocker family;
  - whether the current task owns the blocker;
  - whether the evidence points to prerequisite baseline, harness, runtime-handoff, or task-shape repair.
- If the latest `**BLOCKING ANSWER**` does not clearly classify the blocker, classify it now from current plan evidence before deciding plan impact.
- Use one of these blocker families: product or story seam; proof or test harness seam; shared wrapper or baseline seam; manual or runtime environment seam; task-shape or planning seam.
- Do not rely only on conversational memory for blocker-family or ownership conclusions when the written plan can be read from disk.

</blocker_family_rehydration_rules>

<decision_rules>

If there is or was a blocker, decide whether it reveals any of the following:

- missing prerequisite tasks;
- a task that is too large and must be split;
- a task that assumes a runtime seam, readiness contract, dependency, test harness, environment mapping, or startup contract that does not yet exist;
- a task with testing steps that cannot honestly be run at the point the task is supposed to complete;
- a task that has remained `__in_progress__` across repeated passes without closing its remaining subtasks, showing that it is too broad, too open-ended, too investigative, or insufficiently concrete for the implementation loop;
- a recurring blocker-family mismatch, classified as product or story seam, proof or test harness seam, shared wrapper or baseline seam, manual or runtime environment seam, or task-shape or planning seam;
- later tasks that now require renumbering or reference updates.

Before classifying an apparent manual/runtime blocker as durable, interpret the blocked checklist item by meaning. If the item is only a browser walkthrough, screenshot request, agent-driven manual scenario, or another action owned by the later manual-testing agent, repair the task shape now: preserve and merge the scenario into checkbox-free `Manual Testing Guidance`, remove only the misplaced checklist item, retire the false blocker as resolved, and keep automated completion honest. Do not create a prerequisite or preserve a blocker merely to hand work to an agent that the normal flow can invoke once automated readiness is satisfied.

For a Compose or runtime-handoff blocker, identify the active configuration from `CODEINFO_RUNTIME_COMPOSE_FILE` and compare it with the relevant Dockerfile before assigning ownership. If that checked-in file omits a required harness mapping, treat the repair as repository-owned executable work even when applying the new mapping still requires a later container recreation. Do not classify the problem as external merely because a different Compose variant already contains the mapping.

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

<execution_handoff_rules>

- If blocker repair proves that a different prerequisite task must happen before the currently blocked task can continue, you MUST rewrite task order, dependencies, and task statuses so that prerequisite becomes the next active executable task in the normal implementation loop.
- If the extracted blocker family is product or story seam and the current task owns the implementation bug, keep the repair on the current task unless a prerequisite is still required.
- If the extracted blocker family is proof or test harness seam, add or move the harness proof owner before downstream product continuation when the harness is not already proven.
- If the extracted blocker family is shared wrapper or baseline seam, add baseline or prerequisite ownership instead of returning downstream product tasks to broad-wrapper retries.
- If the extracted blocker family is manual or runtime environment seam, repair the runtime handoff before mutating product code unless the product code clearly owns the runtime failure.
- If the extracted blocker family is task-shape or planning seam, split or rewrite the task into bounded executable work before returning to implementation.
- If the blocker belongs to a shared wrapper, baseline, manual-runtime, or harness family rather than the current task's product seam, prefer explicit prerequisite ownership over repeatedly returning the same task to implementation with broader retries.
- If the blocker belongs to a task-shape or planning family, rewrite the task into bounded executable work before returning to implementation.
- Do not leave the blocked task as the highest-numbered `__in_progress__` task when a different task now owns the next real work.
- When inserting or splitting out a prerequisite owner:
  - move the blocked task out of active `__in_progress__` state;
  - set the prerequisite owner task to `__in_progress__`;
  - rewrite the blocked task so it depends explicitly on that prerequisite;
  - renumber downstream tasks and references if needed so the plan can still be worked through in order.
- If the blocked task still needs later follow-up after the prerequisite lands, keep that work on the blocked task but mark it `__to_do__` until the prerequisite owner is complete.
- A repaired plan is not honest if its notes say `work Task B first` while its task-status state would still make the loop select blocked Task A.

</execution_handoff_rules>

<section_ownership_rules>

- Any task, subtask, testing step, or guidance section created or rewritten by this step MUST follow this section contract:
  - `Subtasks` for implementation work, proof-authoring work, documentation updates, config changes, and explicitly allowed code-hygiene work that can be completed before formal proof runs;
  - `Testing` for automated proof execution only;
  - `Manual Testing Guidance` for optional, non-blocking guidance for the later `manual_testing_agent` pass only when useful.
- Do not create manual testing checklist items in `Subtasks` or `Testing`.
- Do not create subtasks that depend on future automated or manual proof output in order to become complete.
- Do not place automated test execution commands in `Subtasks` unless the task is specifically creating, repairing, or proving a harness or wrapper itself.
- If browser-visible, runtime-visible, or externally observable follow-up would help after the repair, place it only in `Manual Testing Guidance`.

</section_ownership_rules>

<repair_rules>

If any of those are true, you MUST repair the story before continuing:

- insert explicit prerequisite tasks when needed;
- narrow or rewrite a blocked task so it depends only on already proven capabilities;
- renumber all downstream tasks;
- update all cross-references, note-file references, prerequisite references, and testing gates;
- make the new subtasks detailed enough for a junior engineer to follow without asking for help;
- ensure each testing section is runnable at the point that task completes and actually proves the intended work;
- write what changed and why inside the task and implementation notes.
- If this step adds any new unchecked subtask or testing step to a task that is currently `__done__`, you MUST reopen that task to `__in_progress__` unless a different prerequisite owner now takes the active slot and the repaired task should honestly return to `__to_do__`.
- If the blocker exists because repeated implementation passes did not close the remaining subtasks, you MUST repair the task shape before work continues.
- Rewrite, split, or re-own the task so the next implementation pass has a concrete stopping point and does not depend on indefinite narrowing.
- Replace open-ended `keep narrowing until you find the owner` style subtasks with bounded subtasks that have a clear success or blocker threshold.
- A bounded diagnostic task may name:
  - the exact files, logs, fixtures, markers, harnesses, or runtime surfaces to inspect;
  - the exact supported repro surface to use;
  - the exact stopping threshold;
  - the exact exhausted-branch outcome.
- Keep executable automated repro commands in `Testing` unless the diagnostic task is specifically creating, repairing, or proving a harness or wrapper.
- If the same task has already been blocker-repaired once and the next bounded strategy also exhausts cleanly, prefer closing that task on its exhausted branch and creating a fresh successor task rather than narrowing the same task in place again.
- Use in-place repair only when the task still has the same concrete owner and the rewrite is minor.
- If a blocker came from manual testing and the manual tester could not identify a concrete next fix, do not return the task to implementation with vague investigative subtasks.
- In that manual-testing blocker case, either:
  - convert the blocker evidence into concrete bounded implementation subtasks plus proof-authoring subtasks with explicit owners, exact file or surface targets, and clear stopping rules; or
  - create a bounded diagnostic task with exact files or surfaces to inspect, an explicit stopping threshold, and an explicit exhausted-branch outcome.
- Do not encode manual testing itself as a required subtask or testing checklist item.
- If later manual-testing-agent browser or runtime validation would still help after the repair, place it only in `Manual Testing Guidance`.
- Do not keep or create open-ended subtasks like `investigate X until the cause is found` after manual-testing blocker repair.
- If the manual-testing blocker was caused by stale runtime assumptions such as env files, mounted path namespace, ports, seed/setup, stack startup, or artifact location, repair the runtime handoff or add a prerequisite runtime-handoff owner rather than mutating product code first.
- When repairing a blocker that originated from a manual-testing failure, add a separate automated proof-authoring subtask for that failed manual scenario whenever realistic in the affected repository and harness.
- If realistic automated proof is not possible for that manual-testing failure, record that limitation explicitly in the implementation notes instead of silently omitting it.
- Only update the task's `Testing` section when the existing harness-level testing steps would not already run that new proof, and keep any such testing-step additions at the harness or wrapper level only.

If the blocker exists because the current task assumes a missing runtime seam, dependency, readiness surface, test harness, environment mapping, or startup contract, prefer inserting explicit prerequisite tasks over repeatedly retrying the blocked task.

If this step turns the blocker into actionable next work for the current task, you MUST convert the old active blocker note titled exactly `**BLOCKER**` into a historical non-blocking note titled exactly `**RESOLVED ISSUE**` and preserve its details, even when no broader task split or story repair is required. Keep the `**BLOCKING ANSWER**` note as the proof of how the blocker was resolved. Only leave a note titled exactly `**BLOCKER**` in place when the task is still actively blocked after this step.

If the latest `**BLOCKING ANSWER**` concludes that the current task still owns the work, no prerequisite task or task-shape repair is required, and coding, automated proof, or manual testing can continue on the same task, then you MUST retire the live `**BLOCKER**` note in this step. In that case, convert it to `**RESOLVED ISSUE**` even when unchecked `Testing` items still remain on the same task.

Unchecked `Testing` items that are already listed on the current task are normal remaining work, not by themselves a reason to preserve a live `**BLOCKER**`, unless the `**BLOCKING ANSWER**` proves a separate still-active prerequisite, harness, runtime-handoff, baseline, or task-shape blocker.

If this step rewrites, narrows, or re-owns a task in a way that makes all of that task's subtasks and testing steps honestly complete, do not set that task's `Task Status` directly to `__done__`. Leave it as `__in_progress__` so the normal automated-proof audit and manual-testing path can finalize it honestly in the implementation loop, and add an implementation note explaining that planner repair made the task ready for that final completion path.

</repair_rules>

<behavior_rules>

- This step decides plan impact; it does not re-prove the blocker solution from scratch.
- If no story repair is needed, state explicitly why not.
- If the blocker is now answered well enough that coding, automated proof, or manual testing can continue, retire the live `**BLOCKER**` note in this step before the flow returns to the current-task rework loop.
- You MUST NOT leave both of these true at the same time for the same issue: `no plan repair needed` and a live `**BLOCKER**` note that the latest `**BLOCKING ANSWER**` has already made actionable on the same task.
- Do not bypass the normal audit and manual-testing completion path by setting a planner-repaired task directly to `__done__`.
- Do not leave any task `__done__` after this step if you added unchecked subtasks, unchecked testing, or a live `**BLOCKER**` to that task during the repair.
- Do not leave a known plan defect in place once the blocker has proved it.
- Do not leave an old active blocker marker in place when the task is no longer actively blocked after this step.
- Do not encode a prerequisite handoff only in prose or blocker notes; the task-status state must hand execution to the prerequisite task as well.
- Do not return a repeatedly stalled task to the implementation loop unchanged when the blocker evidence shows the task shape itself is the problem.
- Do not let one task accumulate multiple generations of long blocker prose when a fresh successor task would give a cleaner handoff.
- Prefer one concise historical summary plus one current blocker state over repeated full blocker narratives in the same task.
- Do not invent unnecessary extra work; keep repairs aligned to the KISS principle and only add what is required to unblock honest execution.
- Never stop or restart `compose:local` from this planning step. When a checked-in local-runtime repair needs container recreation, make the repair and leave a precise restart handoff while allowing the enclosing flow to exit successfully with its incomplete plan state preserved.

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

- confirm you used fresh bounded blocker and story-scope packets;
- confirm the blocker's plan impact was judged from current plan state rather than memory;
- confirm any missing prerequisite, task split, renumbering, or testing-gate changes were applied consistently;
- confirm any prerequisite handoff was encoded in task status so the next real owner is the one the implementation loop will actually pick;
- confirm the updated plan is runnable and honest at each task boundary after your edits;
- confirm any repaired or newly added task keeps `Testing` automated-only;
- confirm you did not create manual testing checklist items in `Subtasks` or `Testing`;
- confirm you did not create subtasks that depend on future automated or manual proof output;
- confirm any optional manual-testing-agent guidance was placed only in `Manual Testing Guidance`;
- confirm tracked changes were committed if any were made.

</verification_loop>
