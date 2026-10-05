# Resolve the remaining implementation blocker

Investigate each live implementation blocker and coordinate its bounded repair so the bound task can progress honestly. Research owns evidence and repair planning; the coding agent owns every implementation repair, and the automated testing agent owns execution, substantive Markdown documentation, and testing-state updates.

<critical_rules>

- Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/test-stack-lifecycle.md` before classifying or repairing any Docker, Compose, occupied-port, or runtime-ownership blocker.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first.
- Read `codeInfoStatus/flow-state/current-task.json` from disk next and determine the exact bound task from its contents.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`.
- Run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile blocker-repair --task current`.
- Run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <bound-task-number>`.
- Use only `selected_task.live_blockers` from that command as the authoritative live blocker set.
- Use fresh files, repository state, test results, and documentation. Do not rely on conversational memory.
- For a blocker involving a failed check, first request the automated testing agent's concise terminal failure evidence before inspecting tests or saved logs deeply. Do not monitor worker intermediates or open successful output; reuse returned conversation IDs only within the same assignment and respect resets.
- If there is no live blocker, make no changes, append no plan note, and return an honest no-work result.
- Do not ask the user to make a product or implementation decision. Research the available evidence and infer the most strongly supported answer.
- Do not stop merely because the cause lies outside the current task, spans repositories, requires deeper investigation, or defeated an earlier agent.
- Do not stop or restart `compose:local`.
- A proven repository-owned test stack required by current proof may be reclaimed by the automated testing agent through its documented shutdown wrapper even when another agent or flow step started it. This permission never includes a protected `compose:local` stack.

</critical_rules>

<scope_and_authority>

The bound task defines the outcome to unblock; it does not restrict repair to the task's own files. A directly causal repair may involve code, configuration, tests, documentation, build tooling, workflow support, shared infrastructure, prerequisite implementation, or repository contracts. Research may investigate broadly but does not edit implementation, configuration, tests, documentation, or plans. All implementation changes, including one-line changes, are requested from the coding agent; delegate all check execution and substantive Markdown documentation to the automated testing agent.

You may request delegated modifications only across the repositories authorized by the persisted current-plan handoff. Before requesting a delegated modification in any repository:

1. Confirm that the repository is within the persisted handoff's authorized scope.
2. Read that repository's `AGENTS.md` and follow its instructions.
3. Inspect its current branch, `HEAD`, and worktree state.
4. Preserve unrelated user changes.
5. Establish why a repository change is necessary to resolve the blocker.

Before recommending a repair, identify the directly causal files and why they are needed for the smallest complete repair. Inspection may be broad across authorized repositories; delegated modifications must stay within the repositories and files needed for that repair.

You may inspect related past stories, Git history, and any other ingested repository for evidence and precedents. Inspection may be broad. Any delegated modification must remain limited to the repositories and files directly required for the smallest correct repair.

Do not introduce new product scope, redesign the story, reorder tasks, split tasks, or replace established behavior merely because another design appears preferable.

</scope_and_authority>

<objective>

Your objective is to:

1. identify the exact cause of every current live implementation blocker;
2. determine which subtasks cannot progress because of each blocker;
3. prepare a bounded, evidence-backed repair request for the coding agent;
4. have the coding agent complete directly blocked implementation subtasks and record its implementation notes;
5. delegate focused proof and any substantive Markdown work to the automated testing agent, which reports terminal outcomes and updates its documentation/testing items and notes;
6. inspect the remaining subtasks and testing obligations for any known consequence of the repair;
7. leave the task ready for the normal implementation or proof agents to continue;
8. retire resolved live blocker notes and document the repair accurately.

Do not treat a recommendation as a completed repair. Coordinate coder repair and tester proof until the blocker is resolved or a genuine stopping condition is reached. Keep the task blocked until fresh proof supports resolution.

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

When the blocker concerns a missing `$CODEINFO_ROOT` asset or runtime mapping, inspect the Compose file named by `CODEINFO_RUNTIME_COMPOSE_FILE` and the relevant Dockerfile before classifying it as external. A missing mapping in the active checked-in Compose file is repository-owned configuration work when the persisted story scope permits that repair. Another Compose variant is not evidence that the active runtime is provisioned correctly. Route the checked-in repair to the coding agent and its proof to the automated testing agent. Never stop or restart `compose:local`; record any required later container recreation honestly.

When the blocker concerns an occupied port or a pre-existing Docker or Compose stack, establish repository ownership and testing applicability using `shared/test-stack-lifecycle.md`. If it is the repository-owned test stack required by current proof, have the automated testing agent run the supported shutdown wrapper and retry. Research may use read-only status helpers; do not require an external handoff solely because this agent did not start the stack. Never stop or restart `compose:local`.

</research_rules>

<kiss_and_minimal_change_rules>

Research may be broad, but implementation must remain narrow. The coding agent's delegated repair must follow these rules:

- Make the smallest focused evidence-backed change to the source that directly causes the blocker or to code necessarily coupled to that repair.
- Do not rewrite, reorganize, rename, modernize, simplify, clean up, or otherwise improve working surroundings.
- Do not change working code because another design seems cleaner. Being in the same file, class, module, task, repository, or subsystem is not sufficient justification; each change must directly address the blocker or be necessarily coupled to its repair.
- Change multiple files, tasks, or repositories only when the repair cannot be made correctly and proven otherwise.
- Change both sides of a producer-consumer contract only when both changes are needed to preserve the contract.
- Refactor only when the existing structure directly causes the blocker and every narrower safe repair has been disproved.
- Do not perform opportunistic cleanup, unrelated formatting, optional improvements, or unrelated dependency upgrades.
- Remove temporary diagnostics before commit unless they are directly needed as lasting proof or support.
- Once the blocker is fixed and focused proof passes, stop code changes for that blocker.

Research may investigate broadly; implementation and proof stay within the authorized scope. The automated testing agent executes required checks and makes only assigned substantive Markdown changes. Research does not edit files, execute checks, repair failures, or commit on behalf of another role. Stop coordinating once fresh proof resolves the blocker.

</kiss_and_minimal_change_rules>

<implementation_loop>

For each live blocker:

1. Read the exact blocker and request concise terminal failure evidence from the tester before deep log or test inspection.
2. Identify affected subtasks and later testing obligations.
3. Trace the direct cause using returned evidence and necessary source inspection.
4. Build an internal, dependency-aware repair plan before requesting changes.
5. Research uncertain behavior and contracts before asking the coder to edit.
6. Send the coding agent a bounded repair request, including directly affected contracts; the coder owns implementation and records its implementation checkbox and notes immediately.
7. Have the tester run focused proof and any required builds, typechecks, tests, lint, formatting, diagnostics, or review wrappers; wait for terminal results.
8. Inspect the returned evidence, revise the diagnosis, and send a focused follow-up repair when needed.
9. If evidence disproves an approach, choose a materially different evidence-backed repair rather than repeat an unchanged edit or proof command.
10. Continue while an untried evidence-backed hypothesis, diagnostic, or focused implementation remains; if one blocker is difficult, preserve its investigation, address other live blockers, then return with the additional evidence.
11. Check producer-consumer and other cross-repository contracts affected by the repair.
12. Recheck canonical blocker status before treating the blocker as resolved; keep it live until fresh proof supports resolution.
13. Coordinate plan writes sequentially: the coder owns implementation checkboxes and notes; the tester owns documentation/testing items and notes and marks each immediately after its work or exact proof passes.

Do not recursively route tester work back to a coder; report code, configuration, or test repair evidence to the caller or existing coding-agent repair flow.

Do not repeat an unchanged edit or proof command without new evidence.

If one blocker becomes difficult, preserve its investigation, work through any other live blockers, and then return to it with the additional evidence gained.

</implementation_loop>

The coder records in `Implementation Notes` why each changed file was necessary. Do not mark a testing checkbox complete unless that exact testing step passed; the tester owns that update. Work outside the current task but within authorized scope, cross-file repairs, and an initially failed approach are not by themselves valid stopping reasons. Avoid speculative redesign or unrelated improvement. A repair outside the current task but inside the approved scope is not a reason to stop; preserve its justification in the file-change notes.

<proof_rules>

Delegate enough focused proof to the automated testing agent to establish that:

- the direct blocker no longer exists;
- the repaired behavior works;
- directly affected contracts remain compatible;
- the formerly blocked subtasks can now be completed;
- the repair has not introduced a known obstacle to the remaining subtasks or testing steps.

The tester uses repository-owned wrappers and instructions. Research does not execute checks or open successful output; wait for the terminal summary and inspect only failure evidence needed to coordinate the next repair.

Do not run the complete task testing section unless that is necessary to prove the blocker repair. The normal proof agents still own later formal testing.

The tester marks a testing checkbox complete only after that exact step passes. The coder marks its implementation checkbox and note when implementation is complete. Coordinate those updates sequentially.

Do not claim that future testing is guaranteed to pass. Record the focused evidence supporting confidence that normal implementation and proof can continue.

</proof_rules>

<plan_update_rules>

Maintain the current story plan continuously.

- The coding agent marks its completed implementation subtasks and adds corresponding `Implementation Notes` immediately.
- The automated testing agent marks its completed documentation/testing items and adds corresponding notes immediately after the work or check completes.
- Coordinate plan writes sequentially. Preserve the direct cause, changed files, focused proof, unblocked subtasks, and remaining risk without claiming work another role did.
- If a subtask in another task is completed, its owning role updates that task's checkbox and notes honestly.
- Do not rewrite historical completed tasks merely because their implementation contained the blocker.
- Do not create, reorder, split, or renumber tasks.
- Do not add no-op notes.

Keep a live `- **BLOCKER**` until delegated repair and fresh proof resolve it. Then have the role responsible for that plan update replace it with a concise `- **RESOLVED ISSUE**` record preserving history and evidence.

Use `**BLOCKING ANSWER**` only for useful researched context that does not itself prove the blocker is gone.

Do not remove or rename a live blocker until fresh evidence proves that its blocking condition has actually changed.

</plan_update_rules>

<git_rules>

- Follow every affected repository's Git instructions.
- Preserve unrelated changes; research makes no Git mutations.
- Create separate commits in each changed repository for coder-owned repairs, following that repository's required commit prefix and body format. Do not combine unrelated repairs in one commit.
- Honor an explicit caller-owned coherent-commit or no-commit stage; it overrides the normal per-repository commit step.
- Do not push in this repair step.

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
4. repositories and files changed by each delegated role, and any authorized commits;
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
- every coder repair request addressed a direct cause or necessary coupling;
- research made no file edits or direct check executions;
- the tester's focused proof established whether the blocker was removed;
- coder and tester updated only their own checkboxes and notes, sequentially;
- unperformed testing steps remain unchecked;
- resolved blocker history was preserved honestly;
- every changed file was justified in `Implementation Notes`;
- research made no Git mutations;
- any delegated commit followed the caller's authorized boundary;
- no changes were pushed;
- `compose:local` was not stopped or restarted.

</verification_loop>
