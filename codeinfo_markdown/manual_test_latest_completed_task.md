Use fresh disk reads and current git state, not conversational memory.

Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this flow. Re-open the exact relative `plan_path` from disk before deciding what to test, because another agent may have just edited it.

Identify the candidate task for this loop iteration by scanning the plan from bottom to top and selecting the highest-numbered task whose `Task Status` is either `__done__` or `__in_progress__`.

Then apply these rules in order:

1. If there is no such candidate task, report that manual testing is not applicable for this loop pass and do not edit files.
2. If the candidate task is `__in_progress__`, or its implementation notes contain `**BLOCKER**`, or it otherwise is not honestly complete yet, do not perform manual testing. Add a brief implementation note to that task stating that manual testing was skipped because the latest task is not complete yet. If you make tracked changes, you MUST commit them, but do not push.
3. Only if the candidate task is `__done__` should you continue with manual testing consideration.

Before adding a manual-testing implementation note for any outcome, re-read that task's existing implementation notes and avoid adding a duplicate note if the same manual-testing outcome is already recorded from the latest loop pass.

If the candidate task is `__done__`, determine whether the completed change affects a user-visible or browser-accessible surface and whether the required browser-testing tooling actually exists for this repository and runtime shape. Treat a GUI in the system that was edited or a GUI that the edited system connects to as valid proof surfaces.

- If it is not GUI-testable, add a brief implementation note to that task stating that manual testing was assessed and is not applicable because the completed change is not user-visible or browser-accessible. If you make tracked changes, you MUST commit them, but do not push. Then stop.
- If the completed change is GUI-relevant but the required browser-testing tooling does not exist or is not runnable from repository-supported evidence, do not invent a browser proof path. Add `**BLOCKER**` to the implementation notes for that candidate task with a concise explanation of the missing tooling or missing proof path, set that candidate task's `Task Status` to `__in_progress__`, and if you make tracked changes, you MUST commit them, but do not push. Then stop.
- If it is GUI-testable, continue.

Before running manual testing, read:

- `AGENTS.md`
- `README.md`
- `codeinfo_markdown/repository_information.md` if it exists

Use those files to determine how to start the edited system and any required prerequisites. Follow the repository run workflow and prefer the documented wrapper commands where available. Do not invent commands, services, health checks, runtimes, or harnesses that are not supported by repository evidence. If the system was already running, leave it running afterwards. If you started it for this manual test, return it to its prior stopped state when you are done.

Perform manual testing using the Playwright MCP tools and the Chrome DevTools MCP tools. If the completed behavior surfaces through a paired or connected frontend rather than only through the edited repository itself, perform the browser proof through that connected user-facing surface.

Your manual testing must:

- exercise the behaviour modified within the candidate task;
- cover the changed happy path plus the most relevant surrounding regressions and meaningful edge cases that the task affects;
- take and save screenshots where helpful;
- record any other observable proof signals that are needed, such as browser-visible state, console output, or logs that the task expected to change;
- assess whether the GUI is aligned, usable, and correct;
- identify whether any layout, usability, or behavioural issues remain.

If manual testing reveals issues that require more implementation work:

- update that same candidate task by adding new unchecked subtasks for the required follow-up work;
- add matching new unchecked testing steps that would prove those issues are fixed;
- set that candidate task's `Task Status` back to `__in_progress__`;
- add an implementation note stating that manual testing was run, the key issues found, and that new subtasks/testing steps were added;
- if you make tracked changes, you MUST commit them, but do not push.

If manual testing succeeds without finding further work:

- leave the candidate task as `__done__`;
- add an implementation note stating that manual testing was run and that no additional subtasks were needed;
- if you make tracked changes, you MUST commit them, but do not push.

If the change is GUI-testable but you cannot honestly complete the manual test because startup, environment, dependency, or readiness conditions are missing:

- add `**BLOCKER**` to the implementation notes for that candidate task with a concise explanation of what prevented manual testing;
- set that candidate task's `Task Status` to `__in_progress__`;
- if you make tracked changes, you MUST commit them, but do not push.

Keep the implementation notes concise. At the end, report which candidate task you evaluated, whether manual testing was skipped or run, and whether new subtasks or testing steps were added.
