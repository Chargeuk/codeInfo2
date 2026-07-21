# Resolve the remaining implementation blocker

Remove every live implementation blocker preventing the bound task from progressing, complete the subtasks directly blocked by those issues, and leave the task in a state where the normal implementation and testing agents can continue confidently.

<critical_rules>

- Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first.
- Read `codeInfoStatus/flow-state/current-task.json` from disk next and determine the exact bound task from its contents.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`.
- Run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile blocker-repair --task current`.
- Run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <bound-task-number>`.
- Use only `selected_task.live_blockers` from that command as the authoritative live blocker set.
- Use fresh files, repository state, test results, and documentation. Do not rely on conversational memory.
- If there is no live blocker, make no changes, append no plan note, and return an honest no-work result.
- Do not ask the user to make a product or implementation decision. Research the available evidence and infer the most strongly supported answer.
- Do not stop merely because the cause lies outside the current task, spans repositories, requires deeper investigation, or defeated an earlier agent.
- Do not stop or restart `compose:local`.

</critical_rules>

<scope_and_authority>

The bound task defines the outcome that must be unblocked. It does not restrict where the blocker's direct cause may be repaired.

You may repair directly causal code, configuration, tests, documentation, build tooling, workflow support, shared infrastructure, prerequisite implementation, or repository contracts outside the current task when that work is necessary to unblock the bound task.

You may work across the repositories authorized by the persisted current-plan handoff. Before editing any repository:

1. confirm that it belongs to the persisted plan scope;
2. read its repository instructions;
3. inspect its branch, HEAD, and worktree;
4. preserve unrelated user changes;
5. determine why that repository must change.

You may inspect related past stories, Git history, and any other ingested repository for evidence and precedents. Inspection may be broad. Modification must remain limited to the repositories and files directly required for the smallest correct repair.

Do not introduce new product scope, redesign the story, reorder tasks, split tasks, or replace established behavior merely because another design appears preferable.

</scope_and_authority>

<objective>

Your objective is to:

1. identify the exact cause of every current live implementation blocker;
2. determine which subtasks cannot progress because of each blocker;
3. research and implement the smallest complete repair;
4. complete every subtask that was directly blocked and is now honestly complete;
5. run focused proof that demonstrates the blocker is gone;
6. inspect the remaining subtasks and testing obligations for any known consequence of the repair;
7. leave the task ready for the normal implementation or proof agents to continue;
8. retire resolved live blocker notes and document the repair accurately.

Do not merely research, recommend, or describe a possible solution. Plan it, implement it, test it, and iterate until the blocker is resolved or a genuine stopping condition is reached.

</objective>

<research_rules>

When the intended behavior or repair is uncertain, investigate all relevant evidence:

- the current story overview, acceptance criteria, out-of-scope rules, decisions, and implementation notes;
- the bound task and every subtask or testing obligation affected by the blocker;
- related current and past tasks;
- current source code, tests, configuration, logs, and Git history;
- producer-consumer contracts across affected repositories;
- other ingested repositories containing relevant patterns or integrations;
- official framework, library, API, and platform documentation;
- targeted internet research for the exact failure mode and established solutions.

Give priority to:

1. explicit current-story requirements;
2. established user-visible behavior;
3. existing repository and cross-repository contracts;
4. current tests and behavior locks;
5. repository conventions and precedents;
6. official documentation;
7. the smallest reversible evidence-backed solution.

Do not stop because the repair appears to require a product decision. Infer the most strongly supported outcome from the available evidence.

When the blocker concerns a missing `$CODEINFO_ROOT` asset or runtime mapping, inspect the Compose file named by `CODEINFO_RUNTIME_COMPOSE_FILE` and the relevant Dockerfile before classifying it as external. A missing mapping in the active checked-in Compose file is repository-owned configuration work when the persisted story scope permits that repair. Another Compose variant is not evidence that the active runtime is provisioned correctly. Implement and prove the checked-in repair when possible, but never stop or restart `compose:local`; record any required later container recreation honestly.

</research_rules>

<kiss_and_minimal_change_rules>

Research may be broad, but implementation must remain narrow.

- Make the smallest focused evidence-backed change that completely resolves the blocker.
- Do not rewrite, reorganize, rename, modernize, simplify, clean up, or otherwise improve working surrounding code.
- Do not change working code merely because another design appears cleaner or better.
- Modify working code only when it directly causes the blocker or is necessarily coupled to the smallest correct repair.
- Being in the same file, class, module, task, repository, or subsystem is not sufficient justification for changing code.
- Change multiple files, tasks, or repositories only when the repair cannot be correct and provable without those directly coupled changes.
- Change both sides of a producer-consumer contract only when both changes are required to resolve the blocker while preserving established behavior.
- Refactor only when the existing structure directly causes the blocker and every narrower safe repair has been disproved.
- Do not perform opportunistic cleanup, unrelated formatting, optional improvements, or unrelated dependency upgrades.
- Remove temporary diagnostics before committing unless they are directly required as lasting proof or operational support.
- Once the blocker is fixed and focused proof passes, stop changing code for that blocker.

Freedom to repair the real cause is not permission to improve unrelated code.

</kiss_and_minimal_change_rules>

<implementation_loop>

For each live blocker:

1. Read the exact blocker text and its recorded evidence.
2. Identify the affected subtasks and later testing obligations.
3. Trace the blocker to its direct technical cause.
4. Create an internal dependency-aware repair plan.
5. Research uncertain behavior before editing.
6. Implement the smallest complete repair.
7. Run focused repository-owned proof.
8. Inspect failures and revise the diagnosis.
9. Try a materially different focused approach when evidence disproves the previous approach.
10. Continue while an untried evidence source, hypothesis, diagnostic action, or focused implementation remains.
11. Re-check cross-repository contracts directly affected by the repair.
12. Re-run the canonical blocker-status command.
13. Complete and document any formerly blocked subtask that is now honestly complete.

Do not repeat an unchanged edit or proof command without new evidence.

If one blocker becomes difficult, preserve its investigation, work through any other live blockers, and then return to it with the additional evidence gained.

</implementation_loop>

<proof_rules>

Run enough focused proof to establish that:

- the direct blocker no longer exists;
- the repaired behavior works;
- directly affected contracts remain compatible;
- the formerly blocked subtasks can now be completed;
- the repair has not introduced a known obstacle to the remaining subtasks or testing steps.

Use repository-owned wrappers and instructions.

Do not run the complete task testing section unless that is necessary to prove the blocker repair. The normal proof agents still own later formal testing.

Do not mark a testing checkbox complete unless that exact testing step was actually performed successfully.

Do not claim that future testing is guaranteed to pass. Record the focused evidence supporting confidence that normal implementation and proof can continue.

</proof_rules>

<plan_update_rules>

Maintain the current story plan continuously.

- When a blocked subtask is genuinely completed, change its checkbox from `[ ]` to `[x]` immediately.
- Add a concise point to the bound task's `Implementation Notes` immediately after each completed subtask or meaningful repair.
- Record the blocker's direct cause, what was changed, every repository and file changed, why each changed file was necessary, focused proof and its result, which subtasks were unblocked or completed, and any remaining risk or work for the normal agents.
- If an existing subtask in another task is genuinely completed by the repair, update that existing checkbox and its owning task's `Implementation Notes` honestly.
- Do not rewrite historical completed tasks merely because their implementation contained the blocker.
- Do not create, reorder, split, or renumber tasks.
- Do not add no-op notes.

When a blocker is resolved, replace its live `- **BLOCKER**` record with a concise `- **RESOLVED ISSUE**` record that preserves the history and repair evidence.

Use `**BLOCKING ANSWER**` only for useful researched context that does not itself prove the blocker is gone.

Do not remove or rename a live blocker until fresh evidence proves that its blocking condition has actually changed.

</plan_update_rules>

<git_rules>

- Follow every affected repository's Git instructions.
- Preserve unrelated changes.
- Create separate commits in each changed repository.
- Use the repository's required story commit prefix and commit-body format.
- Do not combine unrelated repairs.
- Do not push.

</git_rules>

<stop_conditions>

Stop work on a blocker only when:

- it has been fixed and focused proof passes;
- investigation disproves it or confirms it is already resolved;
- a required repository, dependency, authentication capability, provider, or external service is genuinely unavailable;
- the requested outcome is technically impossible in the available system;
- authoritative requirements remain irreconcilable after the complete evidence search;
- every materially different focused evidence-backed repair has been exhausted;
- or the invocation is approaching its practical execution limit after repeated materially different attempts.

The following are not valid stopping reasons:

- the cause is outside the current task;
- the repair spans multiple files or repositories;
- substantial research or planning is required;
- a product decision initially appears necessary;
- a refactor may be required;
- the normal coding agent already failed;
- the first research or implementation approach failed.

Persistent investigation does not permit speculative redesign or unrelated improvement.

</stop_conditions>

<output_contract>

Return a concise summary containing:

1. the bound task and live blockers found;
2. the direct cause of each blocker;
3. the repair performed;
4. repositories, files, and commits changed;
5. focused proof and results;
6. subtasks completed or unblocked;
7. whether the task is ready for normal implementation or proof to continue;
8. any genuine blocker that remains and the exact reason it could not be resolved.

</output_contract>

<verification_loop>

Before finishing, confirm that:

- the current-plan and current-task handoffs were read from disk;
- a fresh bounded blocker-repair packet was loaded;
- `selected_task.live_blockers` was used as the blocker source of truth;
- no edits or notes were created when no live blocker existed;
- every repair addressed a direct cause or necessary coupling;
- unrelated working code was left unchanged;
- focused proof established that the blocker was removed;
- completed checkboxes were updated immediately;
- unperformed testing steps remain unchecked;
- resolved blocker history was preserved honestly;
- every changed file was justified in `Implementation Notes`;
- tracked changes were committed in each affected repository;
- no changes were pushed;
- `compose:local` was not stopped or restarted.

</verification_loop>
