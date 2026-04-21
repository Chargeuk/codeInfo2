# Story [Number] – [Title]

Note that the title should always be from a user perspective based on what they will be able to do when the story is completed. It should be in the format `[Optional Usertype] Users can [see/perform/do some business based feature]`. For example: `Support Users can monitor the number of polygons a player's machine can handle per second` OR `Users can clear the scene` OR `Users see a confirmation dialogue when attempting to quit` etc...

## Implementation Plan

This is a list of steps that must be followed whilst working on a story. The first step of any plan is to copy this file to a new markdown document that starts with an index padded with zeroes starting at 1 and the title of the story. eg: ./planning/0000001-initial-skeleton-setup.md
Create (or reuse if it already exists) the feature branch for this phase using the established naming convention (for example `feature/<number>-<Title>`).
The Description, Acceptance Criteria & Out Of Scope sections must be fully documented to the point where a very junior, inexperienced developer who has never seen the product before would be able to read and understand what we want to do and why.
The Questions sections should be populated by an AI at the start of the planning phase, as soon as the initial description is provided. As these questions get answered, the questions should be removed and relevent information should be added to the other sections. The Questions section must be empty before creating tasks.

When tasks are later added to this story, use this section contract:

- `Subtasks` are for implementation and proof-authoring work that can be completed before formal proof runs.
- `Testing` is for automated proof execution only.
- `Manual Testing Guidance` is optional, non-blocking guidance for the manual testing agent and must not contain checkboxes.
- Outside `Additional Repositories`, use repository-relative paths, repository aliases, commands, environment-variable names, or other portable lookup directions instead of absolute filesystem paths.
- End each task's `Subtasks` section with separate lint and prettier or format-check subtasks in that order, and end each `Testing` section with separate lint and prettier or format-check steps in that order.
- Keep test-enablement seams such as auth bypasses, seeded identities, mocked providers, or alternate login helpers in test-only harnesses, fixtures, or test configuration rather than in shipped production behavior.
- Prefer the unmodified human Docker stack for manual testing whenever repository evidence shows it is runnable, and only fall back to minimal test-only enablement when the normal stack is not enough.
- Keep automated screenshots and similar generated proof artifacts in ignored artifact locations rather than tracked repository files.
- For any non-final task, put manual-testing screenshots, logs, and similar proof artifacts in `codeInfoTmp/manual-testing/<story-number>/` and do not commit them.
- If a story will rely on non-final manual-proof artifacts and `.gitignore` does not already ignore `codeInfoTmp/`, add or update that ignore rule before later proof depends on the scratch path.
- For the final task, put manual-testing screenshots, logs, and similar proof artifacts in `codeInfoStatus/manual-testing/<story-number>/` and commit them as durable final story proof.
- When Manual Testing Guidance mentions Playwright MCP screenshots, state that screenshots are captured in the Playwright output directory first and then transferred into the target repository artifact destination. `CODEINFO_ROOT` is the harness root and may expose staging paths such as `$CODEINFO_ROOT/playwright-output-local`, but it is not the target artifact root unless the active plan is in the harness repository.

### Description

Overview of where we are now, and where we would like to be once this phase has been completed and why we are implementing this phase. Non-technical, from a user perspective.

### Acceptance Criteria

- Create bullet point objectives here

### Out Of Scope

- Create bullet points of out of scope items here

### Additional Repositories

- If this story needs work outside the current repository, list each additional repository as `- <alias>: /abs/path/to/repository`.
- The current repository is always implicit. If it is also listed here, treat that as redundant and remove or ignore it when the plan is updated.
- If no extra repositories are needed, write exactly `- No Additional Repositories`.

### Questions

- A list of AI generated questions that must be answered before tasking up can start

## Implementation Ideas

- a list of rough implementation ideas for what is required for this story plan. This section should be continuously updated as new information is found or provided.
