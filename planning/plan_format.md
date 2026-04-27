# Story [Number] – [Title]

<Previous Story Information>

## Implementation Plan Instructions

This is the baseline task structure to follow once the story sections above are clear and the work can be implemented without relying on hidden senior knowledge.

1. Read and fully understand the story, the feasibility sections, and the tasks before doing anything else so you know exactly what is required and why.
2. Create or reuse the feature branch for the story using the repository's branching convention.
3. Work through the tasks in order unless a later task explicitly says it can run in parallel.
4. Before touching code for a task, update its `Task Status` to `__in_progress__`.
5. Complete subtasks in order. Mark each checkbox immediately when that subtask is complete.
6. Subtasks should cover implementation and file updates. Write them for a very weak, junior, forgetful developer who may read only the current subtask and may not reliably cross-reference the rest of the story.
7. `Subtasks` must stay executable before formal proof runs. Put automated proof execution in `Testing`, not in `Subtasks`, unless the task is specifically creating or repairing a harness or wrapper.
8. Once all subtasks are complete, run the automated `Testing` section in order and mark each item complete immediately after it passes.
9. If helpful, add a `Manual Testing Guidance` section after `Testing` with optional suggestions for the manual testing agent. Do not use checkboxes or blocking language there.
10. Outside the `Additional Repositories` section, never write full absolute filesystem paths into the plan. Use repository-relative paths, repository aliases, commands, environment-variable names, or other portable lookup directions instead.
11. For any task, direct manual-testing screenshots, logs, and similar proof artifacts to `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and do not commit them.
12. If manual testing for the story will write task-level proof artifacts into `codeInfoTmp/` and `.gitignore` does not already ignore that scratch path, add or update that ignore rule before later proof depends on it.
13. For story closeout, state that a later promotion step curates durable final proof into `codeInfoStatus/manual-proof/<story-number>/`.
14. When Manual Testing Guidance mentions Playwright MCP screenshots, state that screenshots are captured in the Playwright output directory first and then transferred into the target repository task-scoped scratch destination. `CODEINFO_ROOT` is the harness root and may expose staging paths such as `$CODEINFO_ROOT/playwright-output-local`, but it is not the target artifact root unless the active plan is in the harness repository.
15. When useful, recommend deterministic manual-proof basenames such as `proof-01-<slug>.png`, `support-console.txt`, `support-network.json`, and `support-<slug>.log` so later closeout can promote artifacts without guesswork.
16. After the task's implementation and proof are complete, update the `Implementation notes` section with concise, factual notes about what changed, what issues were encountered, and what decisions were made.
17. Record the relevant git commit hash(es) in `Git Commits`, then set the task status to `__done__`.
18. Repeat for the next task.

## Additional Repositories

- If this story needs work outside the current repository, list each additional repository as `- <alias>: /abs/path/to/repository`.
- The current repository is always implicit. If it is also listed here, treat that as redundant and remove or ignore it when the plan is updated.
- If no extra repositories are needed, write exactly `- No Additional Repositories`.

## Feasibility Proof Pass

Use this section when the story needs explicit prerequisite or capability analysis before the tasks begin.

### 1. [Implementation Area Title]

- Already existing capabilities:
  - [Concrete capabilities, files, seams, or tools that already exist.]
- Missing prerequisite capabilities:
  - [Capabilities that must be created before downstream work can rely on them.]
- Assumptions currently invalid:
  - [Important assumptions that the tasking must not rely on yet.]
- Feasibility and sequencing note:
  - [Why the area is feasible and what must happen first.]

## Log Or Proof Markers

Use this section when the story needs explicit runtime markers, screenshots, or other observable proof points before or during the task list.

- Task [N] proof marker: `[Marker Name]`
  - Expected outcome: [What must be observable and why it proves the task.]

## Message Contracts And Storage Shapes

Use this section when the story changes contracts, payloads, schemas, persistence, or shared runtime data shapes.

## Test Harnesses

Use this section when the story requires new harnesses, wrappers, or proof tooling before later tasks can run realistically.

## Edge Cases And Failure Modes

Use this section when the story needs explicit decisions about error handling, recovery, invalid inputs, retries, migrations, compatibility, or degraded behavior.

# Tasks

### Task 1. Task One Title

- Repository Name: exactly one of `Current Repository` or an alias listed in the story's `Additional Repositories` section
- Task Dependencies: `None` or a comma-separated list of earlier task numbers that must complete first
- Task Status: use exactly one of `__to_do__`, `__in_progress__`, or `__done__`
- Git Commits: comma-separated git hashes once the task is implemented

#### Overview

Two or three concise sentences describing what this task achieves, why it is needed now, and why it belongs to this repository.

#### Task Exit Criteria

- [Concrete statement of what must be true for this task to count as done.]
- [Observable proof or behavior that later testing will confirm.]

#### Documentation Locations

- [External documentation, MCP documentation, official URL, or installed library code reference.] State why it is needed.
- [One doc source per bullet.]
- Local repository files to inspect or edit should be listed in the relevant subtasks, not here.

#### Subtasks

1. [ ] Read the relevant story sections plus the existing repository files that define this behavior. Name the exact files, folders, classes, functions, configs, or runtime assets to inspect.
2. [ ] Implement the required code, config, contract, migration, deployment, or runtime changes. Name the exact local files or areas to update.
3. [ ] Add or update the implementation-side proof files for this task, such as unit tests, integration tests, fixtures, schemas, or harness code, naming the exact files to create or change.
4. [ ] Update each required documentation file in its own subtask, naming the exact file and what must change.
5. [ ] Run the exact repository-supported lint command for the files changed by this task, write that exact command in this checklist item, and fix any issues found using any available auto-fix command before manual cleanup when possible.
6. [ ] Run the exact repository-supported prettier or format-check command for the files changed by this task, write that exact command in this checklist item, and fix any issues found using any available auto-fix command before manual cleanup when possible.

Rules:

- Every subtask should be specific enough for a junior developer to execute without extra clarification.
- Every subtask should be understandable in isolation for a very weak, junior, forgetful developer who may only read that one subtask.
- Repeat critical context, exact files, documentation references, commands, and expected outcomes inside the subtask whenever omitting them would force the implementer to guess.
- Do not create investigation subtasks.
- Do not hide important file targets or proof expectations in vague phrases such as "update tests as needed".
- Keep build and test execution commands in the `Testing` section unless the task is specifically creating or fixing a harness or wrapper.
- Do not create manual testing subtasks.
- Do not create subtasks that depend on future automated testing output or future manual testing output in order to become complete.
- Do not plan production-code changes whose only purpose is to disable, bypass, mock, or weaken real production behavior for tests.
- When tests need alternate auth, seeded identities, mocked providers, bypassed 2FA, or similar enablement, keep that enablement in test-only harnesses, fixtures, or test configuration.
- Subtasks may name the exact proof-owning files, log markers, fixtures, screenshot paths, or harness surfaces that must be prepared, but the generated proof output itself belongs to later automated `Testing` or to optional `Manual Testing Guidance`.
- Keep lint and prettier or format-check work as separate final subtasks in that order.
- Lint or prettier fixes may go beyond the narrow story scope when they are required to leave the repository honestly passing.

#### Testing

Plan the task's proof in this order when applicable:

1. [ ] Build the relevant project or projects using the repository's primary Docker or Compose build path when the repository supports containerized builds, following the wrapper-first workflow from `AGENTS.md` where available.
2. [ ] Run the relevant automated tests using the repository's wrapper-first workflow from `AGENTS.md`, or the highest-level safe commands discoverable from the repository if no wrapper guidance exists.
3. [ ] Start the runnable system or required services only if this task's proof needs them.
4. [ ] Stop any system or services started for automated validation.
5. [ ] Run the exact repository-supported lint command for this task's surface, write that exact command in this checklist item, and fix any issues found using any available auto-fix command before manual cleanup when possible.
6. [ ] Run the exact repository-supported prettier or format-check command for this task's surface, write that exact command in this checklist item, and fix any issues found using any available auto-fix command before manual cleanup when possible.

Rules:

- The testing steps must match the task's repository and affected projects.
- `Testing` must contain automated proof steps only.
- Prefer wrapper scripts over low-level direct commands where possible.
- When the repository's primary build mechanism is Docker or Compose, keep that as the first build proof rather than replacing it with ad hoc local build commands.
- Back-end systems should plan unit tests plus Cucumber integration tests using Testcontainers as the primary integration-test path unless the repository's instructions explicitly define a different standard.
- Front-end systems should plan automated unit tests plus automated Playwright end-to-end tests where supported, and may name expected automated screenshot artifacts only when those artifacts are saved to ignored artifact locations rather than tracked repository files.
- Systems where a back end is paired with a front end should keep automated browser proof in `Testing` and place any optional manual-testing-agent browser scenarios in `Manual Testing Guidance`.
- If expected harnesses are missing for the system being changed, add prerequisite harness work earlier in the story before later tasks rely on it.
- If a proof step is not applicable, omit it and explain why in the task wording or implementation notes rather than inventing it.
- If the task depends on a new harness, wrapper, or runtime seam, that prerequisite should be created in an earlier task.
- Keep lint and prettier or format-check work as the final two testing steps in that order.
- Lint or prettier fixes may go beyond the narrow story scope when they are required to leave the repository honestly passing.

#### Manual Testing Guidance

Optional guidance for the manual testing agent only.

- Describe the most useful browser-visible, runtime-visible, or externally observable scenarios to check manually when this task reaches manual validation.
- Name any suggested screenshots, console signals, network checks, or log markers that would help manual validation.
- If manual testing for the story will write task-level proof artifacts into `codeInfoTmp/` and `.gitignore` does not already ignore that scratch path, add or update that ignore rule before later proof depends on it.
- For any task, direct any manual-testing screenshots, logs, or similar proof artifacts to `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and state that they must not be committed because `codeInfoTmp/` is ignored.
- When suggesting Playwright MCP screenshots, state that the MCP tool stages screenshots in the Playwright output directory first and the manual testing agent must transfer them into the target repository task-scoped scratch destination. Use `$CODEINFO_ROOT/playwright-output-local` only as a harness-side staging bind when available.
- When useful, recommend deterministic manual-proof basenames such as `proof-01-<slug>.png`, `support-console.txt`, `support-network.json`, and `support-<slug>.log`.
- For the final task, when the story has a runnable, browser-visible, or otherwise externally observable manual-proof surface, include enough guidance for the `manual_testing_agent` to:
  - identify which services or surfaces must be started;
  - know any prerequisites that must already be running;
  - follow the required startup order when more than one service or surface matters;
  - know where credentials, seeded accounts, helper scripts, fixture data, or env-backed access come from without inlining secrets.
- For the final task, keep task-level manual-testing screenshots, logs, and similar proof artifacts in `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and state that later story closeout promotes a curated durable bundle into `codeInfoStatus/manual-proof/<story-number>/`.
- Prefer the unmodified human Docker stack whenever repository evidence shows it is runnable, especially when supported access already exists for that normal stack.
- Only if the normal human Docker stack is not enough should the plan describe the absolute minimum test-only harness or configuration needed for the `manual_testing_agent`.
- Do not use checkboxes.
- Do not make this section a completion gate.
- Do not require the coding agent to perform any item in this section.
- Do not write actual secrets, passwords, or tokens into the plan. Point only to the supported source of access.

#### Implementation notes

- Starts empty.
- Update it during implementation with concise notes describing what was done, what issues were encountered, and what decisions were made.
- If a blocker is found during implementation, record the exact subtask or testing step, what was attempted, and what capability is missing.

---

### Task 2. Task Two Title

- Repository Name: `Current Repository`
- Task Dependencies: `Task 1`
- Task Status: `__to_do__`
- Git Commits:

#### Overview

[Task overview.]

#### Task Exit Criteria

- [What must be true when this task is complete.]

#### Documentation Locations

- [External documentation reference and why it is needed.]

#### Subtasks

1. [ ] [Detailed subtask.]
2. [ ] Run the repository-supported lint command for this task's surface and fix any issues found, using any available auto-fix command before manual cleanup when possible.
3. [ ] Run the repository-supported prettier or format-check command for this task's surface and fix any issues found, using any available auto-fix command before manual cleanup when possible.

#### Testing

1. [ ] [Relevant proof step.]
2. [ ] Run the repository-supported lint command for this task's surface and fix any issues found, using any available auto-fix command before manual cleanup when possible.
3. [ ] Run the repository-supported prettier or format-check command for this task's surface and fix any issues found, using any available auto-fix command before manual cleanup when possible.

#### Implementation notes

- [Implementation notes go here during execution.]

---

### Task [N]. Final Story Validation And Close-Out

- Repository Name: exactly one of `Current Repository` or an alias listed in the story's `Additional Repositories` section
- Task Dependencies: 1, 2, ..., N-1
- Task Status: `__to_do__`
- Git Commits:
- Notes: This final validation task normally depends on all earlier tasks required for final story proof.

#### Overview

The final task must validate the full story rather than only isolated task-level behavior. It should prove the Acceptance Criteria, important Description requirements, and relevant regression surfaces using the repository's wrapper-first workflow and any final runtime checks that the story actually needs.

#### Task Exit Criteria

- Every Acceptance Criterion and important in-scope behavior is implemented and proved.
- Final documentation and close-out materials are aligned with the final validated behavior.

#### Documentation Locations

- [External docs or MCP references needed for final validation, runtime verification, screenshots, or diagrams.]

#### Subtasks

1. [ ] Re-read the full story and trace the Acceptance Criteria, key Description requirements, and explicit Out Of Scope boundaries against the final task list.
2. [ ] Update final documentation files that the story truly changed, such as `README.md`, `design.md`, `projectStructure.md`, or equivalent repository docs, using one subtask per document.
3. [ ] Produce any required summary or close-out artifact that the repository workflow expects, such as a PR summary, review note, or final evidence summary.
4. [ ] Run the repository-supported lint command for the final validation surface and fix any issues found, using any available auto-fix command before manual cleanup when possible.
5. [ ] Run the repository-supported prettier or format-check command for the final validation surface and fix any issues found, using any available auto-fix command before manual cleanup when possible.

#### Testing

1. [ ] Run the full relevant primary Docker or Compose build wrappers for every affected project or repository when those are the repository's primary build mechanism, otherwise use the highest-level safe build commands.
2. [ ] Run the full relevant automated test wrappers or highest-level safe automated test commands for every affected project or repository.
3. [ ] Start the full runnable system if final story validation requires runtime proof.
4. [ ] Stop any system or services started for automated final validation.
5. [ ] Run the repository-supported lint command for the final validation surface and fix any issues found, using any available auto-fix command before manual cleanup when possible.
6. [ ] Run the repository-supported prettier or format-check command for the final validation surface and fix any issues found, using any available auto-fix command before manual cleanup when possible.

#### Manual Testing Guidance

Optional guidance for the manual testing agent only.

- Describe the most useful final browser-visible, runtime-visible, or externally observable scenarios to check manually after automated proof has completed.
- Name any suggested screenshots, console signals, network checks, or log markers that would help final manual validation.
- Direct any final-task manual-testing screenshots, logs, or similar proof artifacts to `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and state that later story closeout promotes a curated durable bundle into `codeInfoStatus/manual-proof/<story-number>/`.
- When suggesting Playwright MCP screenshots, state that the MCP tool stages screenshots in the Playwright output directory first and the manual testing agent must transfer them into the target repository task-scoped scratch destination. Use `$CODEINFO_ROOT/playwright-output-local` only as a harness-side staging bind when available.
- When useful, recommend deterministic manual-proof basenames such as `proof-01-<slug>.png`, `support-console.txt`, `support-network.json`, and `support-<slug>.log`.
- Prefer the unmodified human Docker stack whenever repository evidence shows it is runnable, especially when supported access already exists for that normal stack.
- Only if the normal human Docker stack is not enough should this section describe the absolute minimum test-only harness or configuration needed for the `manual_testing_agent`.
- Do not use checkboxes.
- Do not make this section a completion gate.
- Do not require the coding agent to perform any item in this section.

#### Implementation notes

- Record final validation outcomes, important proof artifacts, documentation updates, and any final decisions made during story close-out.

---
