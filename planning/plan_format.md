# Story [Number] – [Title]

## Implementation Plan Instructions

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

### Description

Overview of where we are now, and where we would like to be once this phase has been completed and why we are implementing this phase. Non-technical, from a user perspective.

### Acceptance Criteria

- Create bullet point objectives here

### Out Of Scope

- Create bullet points of out of scope items here

### Questions

- A list of AI generated questions that must be answered before tasking up can start

# Implementation Plan

## Instructions

This is a list of steps that must be copied into each new plan. It instructs how a developer work through the tasks.
This should only be started once all the above sections are clear and understood AND all tasks have been created to a level that a very junior, inexperienced developer could work through without asking for help from a senior developer.

1. Read and fully understand the design and tasks below before doing anything else so you know exactly what is required and why.
2. Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
3. Work through the tasks **in order**. Before touching any code, update the Task Status to `In progress`, commit & push that change, and only then begin implementation.
4. For each task, execute every subtask sequentially: before starting a subtask, read the documentation sources listed in that task; after finishing the subtask, run the relevant linters/formatters (Python + TypeScript) and fix issues before continuing.
5. Once a subtask is complete, mark its checkbox.
6. Once all subtasks are done, Move on to the Testing section and work through the tests in order
7. Once a test is complete, mark its checkbox.
8. After tests pass, perform every documentation update listed for the task.
9. Once a document is updated, mark its checkbox.
10. When all subtasks, tests, documentation updates, and verification commands are complete, consider the task finished and follow points 11–13 below.
11. As soon as a task’s implementation is done, add detailed notes in the Implementation notes section covering the code changes, decisions made, and any issues encountered. Push immediately after writing the notes.
12. Record the relevant git commit hash(es) in the Git Commits section. Once they are pushed, set the task status to `Done`, and push again so both the commit IDs and updated status are captured in this document.
13. After a task is fully documented (status, notes, commits), proceed to the next task and repeat the same process.

# Tasks

### 1. Task One Title

- Task Status: The current status of the task. Use exactly one of `__to_do__`, `__in_progress__`, or `__done__`.
- Git Commits: a comma separated list of git hashes that have been committed to implement this story.

#### Overview

Couple of sentences of what this task achieves and why it is needed. Each task should be separated by a horizontal line.

#### Documentation Locations

- Bullet point list of what documentation is needed for the task and where to find it
- Each separate required documentation item should be its own bullet point
- Some documentation is available by mcp such as context7
- Some documentation is available from web URLs
- Some documentation may point to installed library code

#### Subtasks

1. [ ] Numbered list of Subtasks that could be worked through by a very inexperienced, junior and forgetful developer
2. [ ] Each task needs to detail which files, classes and methods to create or update
3. [ x ] Each subtask should ticked as complete when it is implemented
4. [ ] The subtasks must include a list of added tests
5. [ ] The subtasks must include a list of updated documentation files, such as readme.md, design.md & folderStructure.md, each in its own subtask
6. [ ] The last task should always be to run full linting

#### Testing

1. [ ] The fist testing task must always be to prove the server build works outside of docker
2. [ ] The second testing task must always be to prove the client build works outside of docker
3. [ ] The third testing task must always be to prove the CLEAN docker build works
4. [ ] The fourth testing task must always be to prove the docker compose starts
5. [ ] After this testing tasks will depend on running various tests

#### Implementation notes

- This list starts off as empty, but should be updated after each subtask or test is written
- Contains details about the implementation.
- Include what went to plan and what did not.
- Essential that any descisions that got made during the implementation are documented here

---

### 2. Task Two Title

- status: **to_do**
- Git Commits: **to_do**

#### Overview

task overview.

#### Documentation Locations

- Document Locations

#### Subtasks

1. Subtasks list

#### Testing

1. Tests list

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here

---

### [N]. Final Task Title

- status: **to_do**
- Git Commits: **to_do**

#### Overview

The final task must always check against the acceptance criteria of the story. It should perform full clean builds, run the server tests, run the client tests, run the e2e tests, start up the system in docker and use playwright mcp tools to visually check everything is working as expected. screenshots proving this is done should be put into the test-results/screenshots folder. each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot. This task must also ensure that projectStructure.md & design.md is fully up to date. It must also generate a pull request comment based on all changes within the story from all tasks.

#### Documentation Locations

- Docker/Compose: Context7 `/docker/docs`
- Playwright: Context7 `/microsoft/playwright`
- Husky: Context7 `/typicode/husky`
- Mermaid: Context7 `/mermaid-js/mermaid`
- Jest: Context7 `/jestjs/jest`
- Cucumber guides https://cucumber.io/docs/guides/ 

#### Subtasks

1. [ ] Build the server
2. [ ] Build the client
3. [ ] perform a clean docker build
4. [ ] Ensure Readme.md is updated with any required description changes and with any new commands that have been added as part of this story
5. [ ] Ensure Design.md is updated with any required description changes including mermaid diagrams that have been added as part of this story
6. [ ] Ensure projectStructure.md is updated with any updated, added or removed files & folders
7. [ ] Create a reasonable summary of all changes within this story and create a pull request comment. It needs to include information about ALL changes made as part of this story.

#### Testing

1. [ ] run the client jest tests
2. [ ] run the server cucumber tests
3. [ ] restart the docker environment
4. [ ] run the e2e tests
5. [ ] use the playwright mcp tool to ensure manually check the application, saving screenshots to ./test-results/screenshots/ - Each screenshot should be named with the plan index including the preceding seroes, then a dash, and then the task number, then a dash and the name of the screenshot

#### Implementation notes

- Details about the implementation. Include what went to plan and what did not.
- Essential that any decisions that got made during the implementation are documented here

---