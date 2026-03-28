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
7. Build and test execution normally belongs in the `Testing` section, not in `Subtasks`, unless the task is specifically creating or repairing a harness or wrapper.
8. Once all subtasks are complete, run the `Testing` section in order and mark each item complete immediately after it passes.
9. After the task's implementation and proof are complete, update the `Implementation notes` section with concise, factual notes about what changed, what issues were encountered, and what decisions were made.
10. Record the relevant git commit hash(es) in `Git Commits`, then set the task status to `__done__`.
11. Repeat for the next task.

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
5. [ ] Run the first required lint, format, or static-analysis command for the files changed by this task when the repository workflow expects these checks as final subtasks. State the exact command, the expected pass condition, and any available auto-fix command to try first.
6. [ ] Run the next required lint, format, or static-analysis command, again naming the exact command, expected pass condition, and any available auto-fix command to try first. Repeat with additional separate final subtasks if the repository requires more checks.

Rules:

- Every subtask should be specific enough for a junior developer to execute without extra clarification.
- Every subtask should be understandable in isolation for a very weak, junior, forgetful developer who may only read that one subtask.
- Repeat critical context, exact files, documentation references, commands, and expected outcomes inside the subtask whenever omitting them would force the implementer to guess.
- Do not create investigation subtasks.
- Do not hide important file targets or proof expectations in vague phrases such as "update tests as needed".
- Keep build and test execution commands in the `Testing` section unless the task is specifically creating or fixing a harness or wrapper.
- When lint, format, or static-analysis checks are required as subtasks, keep them as separate final subtasks with one explicit command per subtask. If an auto-fix command exists, instruct the implementer to try it before making manual fixes.

#### Testing

Plan the task's proof in this order when applicable:

1. [ ] Build the relevant project or projects using the repository's primary Docker or Compose build path when the repository supports containerized builds, following the wrapper-first workflow from `AGENTS.md` where available.
2. [ ] Run the relevant automated tests using the repository's wrapper-first workflow from `AGENTS.md`, or the highest-level safe commands discoverable from the repository if no wrapper guidance exists.
3. [ ] Start the runnable system or required services only if this task's proof needs them.
4. [ ] Perform manual Playwright or browser automation only if the task affects a user-visible or browser-accessible surface and the tooling exists.
5. [ ] Stop any system or services started for validation.

Rules:

- The testing steps must match the task's repository and affected projects.
- Prefer wrapper scripts over low-level direct commands where possible.
- When the repository's primary build mechanism is Docker or Compose, keep that as the first build proof rather than replacing it with ad hoc local build commands.
- Back-end systems should plan unit tests plus Cucumber integration tests using Testcontainers as the primary integration-test path unless the repository's instructions explicitly define a different standard.
- Front-end systems should plan unit tests plus Playwright end-to-end tests, and include screenshot evidence where the UI can be checked visually.
- Systems where a back end is paired with a front end should include the Playwright end-to-end path plus manual Playwright MCP validation when the tooling exists.
- If expected harnesses are missing for the system being changed, add prerequisite harness work earlier in the story before later tasks rely on it.
- If a proof step is not applicable, omit it and explain why in the task wording or implementation notes rather than inventing it.
- If the task depends on a new harness, wrapper, or runtime seam, that prerequisite should be created in an earlier task.

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

#### Testing

1. [ ] [Relevant proof step.]

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

#### Testing

1. [ ] Run the full relevant primary Docker or Compose build wrappers for every affected project or repository when those are the repository's primary build mechanism, otherwise use the highest-level safe build commands.
2. [ ] Run the full relevant automated test wrappers or highest-level safe automated test commands for every affected project or repository.
3. [ ] Start the full runnable system if final story validation requires runtime proof.
4. [ ] Perform final manual Playwright or browser validation if the story affects a user-visible or browser-accessible surface and the tooling exists. Capture screenshots or other proof artifacts only when they are meaningful to the story.
5. [ ] Stop any system or services started for final validation.

#### Implementation notes

- Record final validation outcomes, important proof artifacts, documentation updates, and any final decisions made during story close-out.

---
