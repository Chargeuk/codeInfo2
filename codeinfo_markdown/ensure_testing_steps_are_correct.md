Please ensure the testing steps for each task are derived from the task's `Repository Name`.

Rules:

1. If the task belongs to `Current Repository`, use this repository's wrapper-first build and test workflow from `AGENTS.md`.
2. If the task belongs to an additional repository, read that repository's `AGENTS.md` first and use that repository's wrapper-first build and test workflow.
3. Do NOT copy this repository's wrapper commands into another repository's task unless that repository explicitly uses the same commands.
4. If the external repository has no wrapper guidance, state the exact commands to run, explain why they are the correct equivalents, and keep the proof steps realistic for that repository.
5. Do not add testing steps for individual narrow tests by default when the repository has wrapper guidance that says to use broader summary wrappers.
6. The testing step numbers should be updated based on the steps actually used within the task.

Log review rule: only open full logs when a wrapper reports failure, unexpected warnings, or unknown/ambiguous failure counts. This preserves tokens while keeping full diagnostics available.
