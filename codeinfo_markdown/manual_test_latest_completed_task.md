# Goal

Manually assess the latest honestly completed task using only the stored plan scope and the current runtime research, then either record a manual-proof result, add follow-up work, or record an honest skip/not-applicable outcome.

<critical_rules>

- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` first and use only the stored `plan_path` and `additional_repositories` as the active scope for this flow.
- Re-open the exact relative `plan_path` from disk before deciding what to test, because another agent may have just edited it.
- Read `codeInfoStatus/flow-state/manual-testing-runtime.json` if it exists and determine its meaning from the information it contains rather than depending on an exact JSON shape.
- Treat the runtime research file as a stored summary of the best supported startup, shutdown, prerequisite, surface, availability, and fallback information for the repositories in scope.
- Use that information to choose the best supported proof path for the candidate task, but re-check that the selected paths still exist on disk before using them.
- If the runtime research file is missing, unreadable, or obviously stale for the relevant repository or surface, state that the manual testing runtime research must be regenerated and do not invent a startup path.

</critical_rules>

<scope_and_runtime_rules>

- Assume the full normal system should be used for manual proof unless the runtime research file, `AGENTS.md`, `README.md`, or `codeinfo_markdown/repository_information.md` explicitly indicates that a specific supported variant should be used instead.
- Do not invent a special testing variant unless repository evidence explicitly supports it.
- Before running manual testing, read:
  - `AGENTS.md`
  - `README.md`
  - `codeinfo_markdown/repository_information.md` if it exists
- Use those files to determine how to start the edited system and any required prerequisites.
- Follow the repository run workflow and prefer documented wrapper commands where available.
- Do not invent commands, services, health checks, runtimes, or harnesses that are not supported by repository evidence.
- If `AGENTS.md` does not define wrapper guidance, prefer the highest-level safe command discoverable from repository evidence.
- Remember that the manual testing agent container and the Playwright MCP server both use Docker host networking, so they can reach the host system through `localhost` when the host system exposes the relevant ports there.
- When repository evidence is not enough to use the browser-testing tools correctly, gather the minimum extra documentation needed before proceeding:
  - use Context7 for current Playwright documentation and examples;
  - use DeepWiki when an external GitHub repository's documentation or architecture is relevant to the manual proof path;
  - use official Playwright docs and targeted web research when repository evidence plus Context7 still leave MCP-tool usage, assertions, screenshots, selectors, waits, or debugging steps ambiguous.
- Keep that documentation lookup minimal and directly tied to the proof you need to run.
- Do not turn this into a broad research pass, and do not use external docs to override repository-specific startup, shutdown, wrapper, login, or environment guidance.

</scope_and_runtime_rules>

<runtime_freshness_rules>

- Treat an already-running stack as stale by default.
- Only reuse an already-running stack when current repository evidence explicitly proves it is fresh enough for the candidate task's proof surface.
- For this repository, if the candidate task changed:
  - server code;
  - client code;
  - compose or runtime configuration;
  - environment wiring;
  - startup or shutdown behavior;
  - or any other runtime-loaded code path;
  then do not reuse an already-running stack unless freshness is explicitly proven.
- Acceptable freshness evidence may include:
  - current runtime-research guidance that explicitly permits reuse for this task shape;
  - a repository-supported marker or command that proves the running stack was started from the current relevant repository state;
  - or other current repository evidence that honestly ties the running runtime to the latest relevant code changes.
- If freshness cannot be proved honestly, stop the running stack and restart it using the documented workflow before manual proof.
- Record in the implementation notes whether manual proof reused a verified-fresh stack or restarted because the prior running stack was stale or of unknown provenance.

</runtime_freshness_rules>

<candidate_selection_rules>

- Identify the candidate task for this loop iteration by scanning the plan from bottom to top and selecting the highest-numbered task whose `Task Status` is either `__done__` or `__in_progress__`.
- If there is no such candidate task, report that manual testing is not applicable for this loop pass and do not edit files.
- If the candidate task is `__in_progress__`, or its implementation notes contain a standalone implementation-note entry whose first token is exactly `**BLOCKER**`, or it otherwise is not honestly complete yet, do not perform manual testing.
- Ignore inline references to `**BLOCKER**`, ignore `**BLOCKING ANSWER**`, and ignore historical notes titled `**RESOLVED ISSUE**` when deciding whether the task is still blocked.
- Add a brief implementation note to that task stating that manual testing was skipped because the latest task is not complete yet.
- Only if the candidate task is `__done__` should you continue with manual testing consideration.
- Before adding a manual-testing implementation note for any outcome, re-read that task's existing implementation notes and avoid adding a duplicate note if the same manual-testing outcome is already recorded from the latest loop pass.

</candidate_selection_rules>

<manual_proof_scope_rules>

- Base manual proof only on the candidate task's own Overview, Task Exit Criteria, Subtasks, and Testing section.
- Do not require later-task-owned UI, observability, queue-visibility, queue-removal, cleanup, or management surfaces unless the candidate task explicitly depends on them.
- If a later task is where that surface is planned to appear, treat its current absence as out of scope for this task rather than as an automatic blocker.
- Determine which runnable or externally observable surfaces the completed change affects.
- At minimum, decide whether the task affects:
  - a runnable system or service that should still start and stop cleanly;
  - a user-visible or browser-accessible surface;
  - an HTTP or network surface that can be proved with tools such as `curl`;
  - a paired or connected frontend where the edited behavior actually appears.
- If the completed task does not affect any runnable, browser-accessible, or externally observable surface, add a brief implementation note stating that manual testing was assessed and is not applicable because the completed change has no relevant runnable proof surface, then stop.
- When manual testing is applicable, explicitly map the manual proof back to the candidate task's visible acceptance-relevant behavior.
- When the candidate task changes transport contracts, request/response shapes, blocking wait behavior, or other observable runtime behavior, prove only the supported surfaces needed to validate that task's owned contract.
- Do not extend manual proof into later-task behavior just because the stack is already running.

</manual_proof_scope_rules>

<execution_rules>

- If the task affects a runnable system or service, you MUST prove as a baseline that it starts successfully and shuts down cleanly using the documented workflow.
- If the system was already running, reuse it only when freshness was explicitly verified for this task.
- If the system was already running but freshness was stale or unknown, stop it and restart it from the documented workflow before manual proof.
- If a verified-fresh system was already running, you may leave it running afterwards after proving it remained healthy.
- If you started it for this manual test, return it to its prior stopped state when you are done.
- Only start the runnable systems or services that the relevant proof actually needs.
- Use the repository's normal launcher, wrapper, startup path, or selector flow when one exists rather than a narrow one-off route.
- Choose manual checks according to the task's actual surface area:
  - use Playwright MCP tools and Chrome DevTools MCP tools when the completed behavior is browser-accessible or user-visible;
  - use `curl` when the completed behavior exposes an HTTP or network surface that can be proved directly that way;
  - use the connected or paired frontend when the edited behavior surfaces there rather than only in the edited repository itself;
  - combine these checks when the task affects more than one surface.
- Whenever applicable, manual testing must:
  - prove the relevant runnable system or service starts successfully and shuts down cleanly;
  - treat startup and shutdown as part of the repository's primary proof workflow for the affected surface rather than as an unrelated side check;
  - exercise the behavior modified within the candidate task;
  - cover the changed happy path plus the most relevant surrounding regressions and meaningful edge cases that the task affects;
  - take and save screenshots for key visible states when the task has a browser-visible or connected frontend surface;
  - inspect browser console output and failed network requests when browser-based proof is used;
  - record any other observable proof signals needed by the task.
  - use those screenshots to assess whether the changed or added GUI is aligned, readable, usable, visually coherent, and correct for the acceptance criteria that can honestly be observed from the frontend;
  - identify whether any layout, usability, behavioral, startup, or shutdown issues remain.
- If the completed task has a browser-visible or connected frontend surface but you do not capture screenshots, treat the manual proof as incomplete unless a concrete tooling limitation prevents capture.
- If screenshot capture is blocked, record that limitation explicitly in the implementation notes instead of silently skipping screenshots.
- Prefer the smallest honest manual proof that validates the candidate task's owned behavior.
- If one proof path contaminates later runtime state and a smaller supported proof path already demonstrated the candidate task's required behavior, stop at the smaller successful proof and record the later-task limitation as a concise implementation note rather than escalating it into a blocker.

</execution_rules>

<outcome_rules>

- If you can honestly prove the candidate task's own changed behavior, but a later-task-owned surface prevents additional convenience, observability, cleanup, or exploratory checks, do not add `**BLOCKER**`.
- Instead, add a concise implementation note stating:
  - what was successfully proved;
  - what additional proof you intentionally did not require because it depends on later planned functionality or out-of-scope surfaces;
  - why that limitation does not invalidate the candidate task's own exit criteria.

- If manual testing reveals an issue, do a bounded diagnosis pass before mutating the task.
- That diagnosis pass must:
  - re-read the relevant task requirements and the changed proof surface;
  - inspect the relevant logs, console output, network failures, screenshots, or API responses;
  - inspect the most likely local code paths that own the observed failure;
  - rerun the smallest honest repro path;
  - if needed, add temporary diagnostic log lines or other minimal instrumentation, restart the affected runtime, and rerun the repro a small bounded number of times.
- Remove purely temporary diagnostic instrumentation before finishing this step unless it is genuinely useful production or test logging.
- Do not add speculative follow-up subtasks before that diagnosis pass is complete.

- If manual testing reveals issues that require more implementation work:
  - only add new subtasks if the diagnosis pass identified a concrete failing seam, owner, or contract mismatch;
  - update that same candidate task by adding new unchecked subtasks for the required follow-up work;
  - write every newly added subtask with the same level of detail and local context as the existing tasking;
  - make every newly added subtask name the exact file, harness, route, component, test file, or proof artifact to change and the exact behavior to fix or prove;
  - do not add vague subtasks such as `investigate X`, `debug Y`, or `look into Z` unless the task is explicitly being reshaped into a bounded diagnostic task by planner repair;
  - when an issue can realistically be covered by automated proof, add a separate new unchecked proof-authoring subtask for that one automated test change;
  - each new automated proof-authoring subtask must cover exactly one automated proof addition or update, name the exact test file, harness, or proof artifact to create or edit, and explain what behavior it must prove;
  - if a suitable automated proof addition is not realistically possible, do not invent one; instead add an implementation note stating why automated proof could not honestly be added for that manual finding;
  - update the task's `Testing` section only when the existing harness-level testing steps would not already run the new automated proof;
  - keep any added or updated `Testing` section steps at the harness or wrapper level only and never add narrow individual-test execution steps there;
  - do not add manual testing, Playwright MCP, browser-driven agent validation, screenshot review, or any other manual-proof step to the task's `Testing` section;
  - if extra manual validation will still be needed after the fix, mention that only in implementation notes and not as a task testing step;
  - when the repository workflow expects lint, format, or static-analysis checks as subtasks, add separate final unchecked subtasks for those code-hygiene commands;
  - set that candidate task's `Task Status` back to `__in_progress__`;
  - uncheck any existing checked testing steps whose proof is no longer honestly current because the newly added work will require them to be rerun;
  - add an implementation note stating that manual testing was run, the key issues found, that new subtasks or testing steps were added, and that the affected testing steps were unchecked because they must be rerun after the fixes.

- If the diagnosis pass does not identify a concrete next fix honestly:
  - do not invent speculative subtasks;
  - add `**BLOCKER**` instead;
  - record:
    - the failing manual repro;
    - what was inspected;
    - what temporary instrumentation or restarts were tried;
    - what remains unknown;
    - what evidence is still missing;
  - set that candidate task's `Task Status` to `__in_progress__`.

- If manual testing succeeds without finding further work:
  - leave the candidate task as `__done__`;
  - add an implementation note stating that manual testing was run, which visible acceptance-relevant outcomes were proved, whether screenshots were captured, where the screenshot artifacts were saved, and that no additional subtasks were needed.

- If you cannot honestly complete the relevant manual proof because startup, shutdown, environment, dependency, tooling, or readiness conditions are missing:
  - add `**BLOCKER**` only when you cannot honestly prove a behavior that is required by the candidate task's own exit criteria using supported surfaces that should already exist at this point in the plan;
  - do not use `**BLOCKER**` for limitations caused only by later-task-owned observability, queue-management, UI, cleanup, or convenience surfaces;
  - add `**BLOCKER**` to the implementation notes for that candidate task with a concise explanation of what prevented manual testing;
  - set that candidate task's `Task Status` to `__in_progress__`.

- If manual testing does not run for any reason, add one concise implementation note stating that manual testing was skipped or assessed as not applicable, and why, unless that exact latest-loop outcome is already recorded and would be duplicated.
- Keep the implementation notes concise.
- If you make tracked changes in this step, you MUST commit them, but do not push.

</outcome_rules>

<output_contract>

- Report which candidate task you evaluated.
- Report whether manual testing was skipped, assessed as not applicable, run successfully, or blocked.
- Report whether new subtasks or testing steps were added.
- Report whether the task status changed back to `__in_progress__`.

</output_contract>

<verification_loop>

- Confirm you used only the stored handoff and runtime-research scope.
- Confirm you selected the highest-numbered `__done__` or `__in_progress__` task honestly.
- Confirm you did not require later-task-owned surfaces unless the candidate task explicitly depended on them.
- Confirm any failure-triggered follow-up work came after a bounded diagnosis pass rather than from first-guess speculation.
- Confirm any new subtasks and proof-authoring subtasks are detailed enough for a weak junior agent to follow.
- Confirm no vague `investigate` or `debug` subtasks were added unless planner repair explicitly turned the work into a bounded diagnostic task.
- Confirm no manual-testing step was added to the task's `Testing` section.
- Confirm every non-run outcome left a short implementation note unless that same latest-loop outcome was already recorded.

</verification_loop>
