Use fresh disk reads and current git state, not conversational memory.

Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this flow. Re-open the exact relative `plan_path` from disk before deciding what to test, because another agent may have just edited it.

Read `codeInfoStatus/flow-state/manual-testing-runtime.json` if it exists. Determine its meaning from the information it contains rather than depending on an exact JSON shape. Treat it as a stored summary of the best supported startup, shutdown, prerequisite, surface, availability, and fallback information for the repositories in scope. Use that information to choose the best supported proof path for the candidate task, but re-check that the selected paths still exist on disk before using them. If the runtime research file is missing, unreadable, or obviously stale for the relevant repository or surface, state that the manual testing runtime research must be regenerated and do not invent a startup path.

Assume the full normal system should be used for manual proof unless the runtime research file, `AGENTS.md`, `README.md`, or `codeinfo_markdown/repository_information.md` explicitly indicates that a specific supported variant, seeded mode, login-helper mode, alternate startup path, or test-support runtime should be used instead. Do not invent a special testing variant unless repository evidence explicitly supports it.

Identify the candidate task for this loop iteration by scanning the plan from bottom to top and selecting the highest-numbered task whose `Task Status` is either `__done__` or `__in_progress__`.

Then apply these rules in order:

1. If there is no such candidate task, report that manual testing is not applicable for this loop pass and do not edit files.
2. If the candidate task is `__in_progress__`, or its implementation notes contain `**BLOCKER**`, or it otherwise is not honestly complete yet, do not perform manual testing. Add a brief implementation note to that task stating that manual testing was skipped because the latest task is not complete yet. If you make tracked changes, you MUST commit them, but do not push.
3. Only if the candidate task is `__done__` should you continue with manual testing consideration.

Before adding a manual-testing implementation note for any outcome, re-read that task's existing implementation notes and avoid adding a duplicate note if the same manual-testing outcome is already recorded from the latest loop pass.

If the candidate task is `__done__`, determine which runnable or externally observable surfaces the completed change affects. At minimum, decide whether the task affects:

- a runnable system or service that should still start and stop cleanly;
- a user-visible or browser-accessible surface;
- an HTTP or network surface that can be proved with tools such as `curl`;
- a paired or connected frontend where the edited behavior actually appears.

If the completed task does not affect any runnable, browser-accessible, or externally observable surface, add a brief implementation note to that task stating that manual testing was assessed and is not applicable because the completed change has no relevant runnable proof surface. If you make tracked changes, you MUST commit them, but do not push. Then stop.

Before running manual testing, read:

- `AGENTS.md`
- `README.md`
- `codeinfo_markdown/repository_information.md` if it exists

Use those files to determine how to start the edited system and any required prerequisites. Follow the repository run workflow and prefer the documented wrapper commands where available. Do not invent commands, services, health checks, runtimes, or harnesses that are not supported by repository evidence. If the task affects a runnable system or service, you MUST prove as a baseline that it starts successfully and shuts down cleanly using the documented workflow. If the system was already running, leave it running afterwards after proving it remained healthy. If you started it for this manual test, return it to its prior stopped state when you are done.

Only start the runnable systems or services that the relevant proof actually needs. Use the repository's normal launcher, wrapper, startup path, or selector flow when one exists rather than a narrow one-off route. If `AGENTS.md` does not define wrapper guidance, prefer the highest-level safe command discoverable from repository evidence.

Remember that the manual testing agent container and the Playwright MCP server both use Docker host networking, so they can reach the host system through `localhost` when the host system exposes the relevant ports there.

When repository evidence is not enough to use the browser-testing tools correctly, gather the minimum extra documentation needed before proceeding:

- use Context7 for current Playwright documentation and examples;
- use DeepWiki when an external GitHub repository's documentation or architecture is relevant to the manual proof path;
- use official Playwright docs and targeted web research when repository evidence plus Context7 still leave MCP-tool usage, assertions, screenshots, selectors, waits, or debugging steps ambiguous.

Keep that documentation lookup minimal and directly tied to the proof you need to run. Do not turn this into a broad research pass, and do not use external docs to override repository-specific startup, shutdown, wrapper, login, or environment guidance.

Choose manual checks according to the task's actual surface area:

- use Playwright MCP tools and Chrome DevTools MCP tools when the completed behavior is browser-accessible or user-visible;
- use `curl` when the completed behavior exposes an HTTP or network surface that can be proved directly that way;
- use the connected or paired frontend when the edited behavior surfaces there rather than only in the edited repository itself;
- combine these checks when the task affects more than one surface.

Your manual testing must, whenever applicable:

- prove the relevant runnable system or service starts successfully and shuts down cleanly;
- treat startup and shutdown as part of the repository's primary proof workflow for the affected surface rather than as an unrelated side check;
- exercise the behaviour modified within the candidate task;
- cover the changed happy path plus the most relevant surrounding regressions and meaningful edge cases that the task affects;
- take and save screenshots where helpful;
- record any other observable proof signals that are needed, such as browser-visible state, console output, or logs that the task expected to change;
- assess whether any relevant GUI is aligned, usable, and correct;
- identify whether any layout, usability, behavioural, startup, or shutdown issues remain.

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

If you cannot honestly complete the relevant manual proof because startup, shutdown, environment, dependency, tooling, or readiness conditions are missing:

- add `**BLOCKER**` to the implementation notes for that candidate task with a concise explanation of what prevented manual testing;
- set that candidate task's `Task Status` to `__in_progress__`;
- if you make tracked changes, you MUST commit them, but do not push.

Keep the implementation notes concise. At the end, report which candidate task you evaluated, whether manual testing was skipped or run, and whether new subtasks or testing steps were added.
