# Goal

Manually assess the latest honestly completed task using the stored plan scope and current runtime research as the primary context, then either record a manual-proof result, add follow-up work, or record an honest skip/not-applicable outcome.

<critical_rules>

- Before doing anything else, read `$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md` and follow it.
- Use fresh disk reads and current git state, not conversational memory.
- Read `codeInfoStatus/flow-state/current-plan.json` from disk first, for example with `cat codeInfoStatus/flow-state/current-plan.json`, and use the stored `plan_path` and `additional_repositories` as the primary story context for this flow.
- For manual proof only, you may inspect and run additional supporting repositories when they are reasonably needed to perform honest proof for the active story or bound task.
- Do not treat a supporting repository outside `additional_repositories` as a blocker by itself.
- Read `codeInfoStatus/flow-state/current-task.json` from disk after `current-plan.json`, for example with `cat codeInfoStatus/flow-state/current-task.json`, and determine the bound task from what it contains rather than depending on an exact JSON shape.
- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md`, then run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile manual-proof --task current` before deciding what to test, because another agent may have just edited the bound task.
- If `current-task.json` does not clearly resolve a task for this loop pass, state that manual testing must wait for task resolution and do not invent a different candidate task.
- After resolving the bound task number, run `python3 "$CODEINFO_ROOT/scripts/manual_testing_guidance_status.py" --task-number <that-number>` and use its JSON output as the source of truth for whether story-level and task-level manual-testing guidance are present in the active plan.
- Read `codeInfoStatus/flow-state/manual-testing-runtime.json` if it exists and determine its meaning from the information it contains rather than depending on an exact JSON shape.
- Treat the runtime research file as a stored summary of the best supported startup, shutdown, prerequisite, surface, availability, and fallback information for the repositories in scope.
- The runtime research file may legitimately be absent between regeneration steps because it is live local research rather than a durable tracked handoff artifact.
- Use that information to choose the best supported proof path for the candidate task, but re-check that the selected paths still exist on disk before using them.
- If the runtime research file is missing, unreadable, or obviously stale for the relevant repository or surface, state that the manual testing runtime research must be regenerated and do not invent a startup path.
- Read any story-level `Story Manual Testing Guidance` when it exists and use it as optional story-scoped default input for later manual proof.
- Read the bound task's `Manual Testing Guidance` section when it exists and use it as task-scoped execution input that may refine or override story-level guidance, as long as it does not conflict with fresher repository evidence or the stored runtime research.

</critical_rules>

<scope_and_runtime_rules>

- Assume the full normal system should be used for manual proof unless the runtime research file, `AGENTS.md`, `README.md`, or `codeinfo_markdown/repository_information.md` explicitly indicates that a specific supported variant should be used instead.
- Do not invent a special testing variant unless repository evidence explicitly supports it.
- Before running manual testing, read:
  - `AGENTS.md`
  - `README.md`
  - `codeinfo_markdown/repository_information.md` if it exists
- Use those files to determine how to start the edited system and any required prerequisites.
- If the changed behavior is actually proved through a paired or supporting application in another repository, you may use that repository for manual proof even when it is outside the story's declared working repositories.
- Prefer the smallest honest supporting runtime needed for proof rather than starting unrelated systems.
- Follow the repository run workflow and prefer documented wrapper commands where available.
- Do not invent commands, services, health checks, runtimes, or harnesses that are not supported by repository evidence.
- If `AGENTS.md` does not define wrapper guidance, prefer the highest-level safe command discoverable from repository evidence.
- Before escalating a manual-testing problem into a blocker, task reopen, or follow-up implementation work, check whether `AGENTS.md` or, if it exists, `codeinfo_markdown/repository_information.md` defines repository-specific conditions that allow manual proof to be narrowed or skipped. If such a repository-defined skip condition is currently being met, follow that repository policy instead of inventing broader repair work.
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

<blocker_detection_rules>

- Before deciding whether the candidate task is blocked, read `$CODEINFO_ROOT/codeinfo_markdown/shared/blocker-detection.md`.
- Determine the bound task number from `current-task.json`, then run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --task-number <that-number>`.
- Use the parser output, not visual scanning, to determine whether the selected task contains any live blocker lines.
- Treat only lines reported by the parser under `selected_task.live_blockers` as live blockers for candidate selection.
- If the parser-selected task does not match the bound task from `current-task.json`, stop and say the task handoff must be regenerated before manual testing continues.

</blocker_detection_rules>

<candidate_selection_rules>

- Use the task already resolved into `current-task.json` as the candidate task for this loop iteration.
- Determine candidate eligibility from honest checklist and blocker state, not from `Task Status` alone.
- Ignore inline references to `**BLOCKER**`, ignore `**BLOCKING ANSWER**`, and ignore historical notes titled `**RESOLVED ISSUE**` when deciding whether the task is still blocked.
- If the parser-selected task still has unchecked subtasks, unchecked testing steps, or a live standalone `**BLOCKER**`, do not perform manual testing.
- Add a brief implementation note to that task stating that manual testing was skipped because the latest task is not honestly complete yet.
- If the parser-selected task has no unchecked subtasks, no unchecked testing steps, and no live standalone `**BLOCKER**`, it is eligible for manual testing whether its `Task Status` is `__in_progress__` or `__done__`.
- Before adding a manual-testing implementation note for any outcome, re-read that task's existing implementation notes and avoid adding a duplicate note if the same manual-testing outcome is already recorded from the latest loop pass.

</candidate_selection_rules>

<final_story_scope_rules>

- After selecting the candidate task, determine whether it is the highest-numbered real task in the story.
- If the candidate task is not the final task in the story, keep manual proof task-scoped.
- If the candidate task is the final task in the story and it is eligible for manual testing, expand manual proof to full-story scope.
- In that final-task case:
  - first prove the final task's own acceptance-relevant behavior;
  - then run a concise end-to-end manual validation of the story's visible or externally observable outcomes across the earlier completed tasks that matter to the user-facing or externally observable story result;
  - use the story Overview, any applicable story-level `Story Manual Testing Guidance`, the final task's Task Exit Criteria, and the completed task sequence as the scope for that broader proof;
  - when the story acceptance criteria can be proved more durably with artifacts, generate them where possible, such as Playwright MCP screenshots for visible states, browser console or network evidence for browser proof, and log lines or other observable runtime markers for backend-facing acceptance criteria;
  - tie each generated artifact back to the specific story acceptance criterion or externally observable outcome it proves;
  - keep follow-up work on the final task unless the failure clearly requires planner repair because the plan boundary is now wrong.
- Record in the implementation notes whether the pass stayed task-scoped or expanded to full-story proof because the candidate task was the final task in the story.

</final_story_scope_rules>

<manual_proof_artifact_rules>

- Derive the story number from the active plan filename before saving any manual-proof artifact.
- Derive the bound task number from `current-task.json` before saving any manual-proof artifact, and use that same task number consistently for scratch-proof storage in this step.
- Keep all manual-proof artifact paths repository-relative rather than absolute.
- The repository-relative artifact paths below are relative to the target repository that owns the active `plan_path`, not necessarily the harness repository at `CODEINFO_ROOT`.
- Before transferring artifacts, resolve that target repository root from the active workflow repository or the directory containing the stored `plan_path`, for example with `git rev-parse --show-toplevel` from the selected working repository, and verify the resolved root is not accidentally `CODEINFO_ROOT` unless the active plan is actually in the harness repository.
- Use `CODEINFO_ROOT` only for harness-owned files and staging locations, such as `$CODEINFO_ROOT/playwright-output-local`; do not treat `CODEINFO_ROOT` as the target artifact root unless the active plan itself is in the harness repository.
- Save any manual-testing screenshots, logs, console captures, network captures, or similar proof artifacts under `codeInfoTmp/manual-testing/<story-number>/<task-number>/`.
- Treat `codeInfoTmp/manual-testing/<story-number>/<task-number>/` as the latest non-committed scratch proof for that one task because `codeInfoTmp/` is ignored.
- If that same task is being manually retested, clear or replace the existing task folder contents before relying on new artifacts from the latest pass.
- Save screenshot proof with basenames matching `proof-<nn>-<slug>.<ext>`, such as `proof-01-home.png`, so later closeout can promote them deterministically.
- Save supporting console, network, and log captures with deterministic basenames such as `support-console.txt`, `support-network.json`, and `support-<slug>.log`.
- The later story-closeout promotion step may copy a curated subset of this scratch proof into `codeInfoStatus/manual-proof/<story-number>/`, but this manual-testing step does not write durable story proof there directly.
- If screenshot or log capture is blocked, record the intended artifact destination in the implementation notes instead of inventing another storage location.

</manual_proof_artifact_rules>

<playwright_mcp_artifact_transfer_rules>

- Playwright MCP screenshot paths are resolved inside the Playwright runtime output directory, normally `/tmp/playwright-output`; they are not resolved relative to the target repository.
- Do not pass an absolute target-repository path to Playwright MCP screenshot tools. Playwright MCP rejects paths outside its output directory.
- Capture screenshots with a deterministic relative staging path, such as `manual-testing/<story-number>/<task-number>/proof-01-home.png`.
- After capture, transfer the screenshot into `codeInfoTmp/manual-testing/<story-number>/<task-number>/` as a direct child file of that task folder, for example `codeInfoTmp/manual-testing/<story-number>/<task-number>/proof-01-home.png`.
- Do not recreate the Playwright staging subdirectories such as `manual-testing/<story-number>/<task-number>/` inside the repository destination folder.
- After capture, transfer the image into the target repository artifact destination from `<manual_proof_artifact_rules>`.
- For the codeInfo2 local harness workflow, any Playwright MCP artifact saved under `/tmp/playwright-output/<relative-path>` inside the local Playwright MCP runtime will appear at `$CODEINFO_ROOT/playwright-output-local/<relative-path>` on the host. When the manual-testing agent is using its normal Playwright MCP runtime, look there first for captured screenshots or other Playwright MCP-written artifacts. This is a staging source, not the final target repository artifact destination.
- Do not assume the app-under-test compose stack is also the source of Playwright MCP screenshots; the tested runtime and the screenshot-producing Playwright runtime may differ.
- Only skip the `$CODEINFO_ROOT/playwright-output-local/<relative-path>` check when current runtime evidence explicitly proves the active Playwright MCP runtime does not expose that bind path.
- When the bind path is unavailable, copy the file out of the exact Playwright MCP runtime recorded in `codeInfoStatus/flow-state/manual-testing-runtime.json`; do not guess a container from the app-under-test stack.
- For this codeInfo2 harness workflow, prefer the recorded local Playwright MCP container such as `codeinfo2-playwright-mcp-local` when a container copy-out fallback is genuinely needed.
- Create the target destination directory in the target repository before copying artifacts into it.
- Verify the target repository file exists after transfer and inspect the saved image before relying on it as proof.
- Record both the Playwright staging relative path and the final target repository-relative artifact path in the implementation notes.
- If neither the harness bind path nor the container copy-out path is available, classify the issue under the outcome rules instead of claiming the screenshot was saved.

</playwright_mcp_artifact_transfer_rules>

<story_and_task_guidance_rules>

- Before executing manual proof, read story-level `Story Manual Testing Guidance` when it exists.
- Before executing manual proof, read the bound task's `Manual Testing Guidance` section when it exists.
- Use story-level guidance to shape shared defaults such as:
  - startup order;
  - shared proof surfaces;
  - shared prerequisite services;
  - shared login, seed, or setup expectations;
  - shared credential-source lookup;
  - shared manual-proof artifact expectations.
- Use task-level guidance to shape task-specific execution details such as:
  - which surfaces to test;
  - startup order;
  - prerequisite services;
  - login, seed, or setup path;
  - credential-source lookup;
  - manual-proof artifact destination.
- Apply story and task guidance in this precedence order:
  1. repository truth and safety from `AGENTS.md`, current repository evidence, and the stored runtime research;
  2. the bound task's `Manual Testing Guidance` as the task-scoped execution overlay;
  3. story-level `Story Manual Testing Guidance` as optional story-scoped defaults;
  4. no invention beyond those sources.
- If story-level guidance is missing, continue normally and do not treat that as a blocker.
- If the bound task's `Manual Testing Guidance` is missing, incomplete, or stale for the proof surface, continue with the best supported repository and runtime evidence plus any story-level guidance rather than guessing.
- If task-level guidance conflicts with story-level guidance for the same decision area, prefer the task-level guidance and record the override honestly in the implementation notes instead of silently following one source.
- If story-level guidance or task-level guidance conflicts with fresher repository evidence or the stored runtime research, prefer the fresher evidence and record the conflict honestly in the implementation notes instead of silently following or ignoring the guidance.
- If the active plan explicitly names design-target assets intended as implementation references, treat that as `Design Contract Present` for this manual-testing pass.
- If `Design Contract Present` is true, identify the task-owned or story-owned design assets that the candidate task's visible surfaces are expected to match before starting browser proof.
- If `Design Contract Present` is true, evaluate visual conformance in this order: the current task's explicit subtasks and task-level requirements first, then the story plan or `Design Contract`, then paired design markdown, then the supporting visual asset.
- Only explicit task wording overrides lower-precedence design sources. Broad wording such as `match the redesign` does not override the story plan or `Design Contract`, paired design markdown, or the supporting visual asset by itself.
- If `Design Contract Present` is true and the candidate task is the final task in the story, identify the full set of implemented frontend surfaces across the whole story that later review will expect screenshots for.

</story_and_task_guidance_rules>

<manual_proof_scope_rules>

- Base manual proof on the candidate task's own Overview, Task Exit Criteria, Subtasks, and Testing section, plus any applicable story-level `Story Manual Testing Guidance`.
- For non-final tasks, use story-level guidance only as shared defaults, shared setup expectations, shared artifact expectations, or other instructions that explicitly apply to every manual pass.
- Do not require later-task-owned UI, observability, queue-visibility, queue-removal, cleanup, or management surfaces unless the candidate task explicitly depends on them.
- If a later task is where that surface is planned to appear, treat its current absence as out of scope for this task rather than as an automatic blocker.
- Determine which runnable or externally observable surfaces the completed change affects.
- At minimum, decide whether the task affects:
  - a runnable system or service that should still start and stop cleanly;
  - a user-visible or browser-accessible surface;
  - an HTTP or network surface that can be proved with tools such as `curl`;
  - a paired or connected frontend where the edited behavior actually appears.
- When the edited behavior is surfaced through a paired or supporting repository, treat that paired surface as in scope for manual proof.
- Do not fail manual proof solely because the required visible or externally observable surface lives outside the declared story repositories.
- If the completed task does not affect any runnable, browser-accessible, or externally observable surface, add a brief implementation note stating that manual testing was assessed and is not applicable because the completed change has no relevant runnable proof surface. If the candidate task is also the final task in the story, state that full-story manual testing was also assessed and remained not applicable for the same reason. Then stop.
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
- If `Design Contract Present` is true and the task has a browser-visible or connected frontend surface, manual testing must also:
  - compare each captured screenshot against the current task's explicit visual requirements for that view first; if the task is silent on that point, fall back to the story plan or `Design Contract`, then to paired design markdown, and finally to the supporting visual asset;
  - record for each comparison whether it `matches`, has a `minor mismatch`, or has a `material mismatch`;
  - summarize what matches and what differs in the implementation notes or retained support artifact, including whether the judgment came from the explicit task contract, the story plan or `Design Contract`, the paired design markdown, the visual design asset, or a combination;
  - if the implementation matches an explicit current-task requirement but differs from paired design markdown or the supporting visual asset on that same point, do not treat that difference by itself as a mismatch;
  - if the current task is silent on that point, fall back to the story plan or `Design Contract`, then to paired design markdown, then to the supporting visual asset;
  - if the current task is vague and the implementation diverges from the highest-precedence fallback source that answers that point, without an explicit task-level override, treat that as a mismatch against the design contract. That fallback order is: story plan or `Design Contract`, then paired design markdown, then the supporting visual asset.
  - treat screenshot capture alone as insufficient proof of visual conformance.
- If the candidate task is the final task in the story and has a browser-visible or connected frontend surface, manual testing must try to capture screenshots for all implemented frontend surfaces across the story that can honestly be exercised in this pass.
- If the completed task has a browser-visible or connected frontend surface, manual testing must try to capture the relevant screenshots whenever honest tooling and runtime access allow it.
- If screenshot capture is blocked or incomplete, record that limitation explicitly in the implementation notes instead of silently skipping screenshots, but do not treat missing screenshots by themselves as a reason to reopen the task or add follow-up work.
- Save any captured manual-proof artifacts to the correct repository-relative scratch destination for this task: `codeInfoTmp/manual-testing/<story-number>/<task-number>/`.
- For Playwright MCP screenshots, first capture to the Playwright MCP output directory with a relative staging path, then transfer the file to the repository-relative destination above using the `playwright_mcp_artifact_transfer_rules`.
- If `Design Contract Present` is true, keep the screenshot basenames and comparison notes specific enough that a later reviewer can tell which retained screenshot corresponds to which design asset.
- Prefer the smallest honest manual proof that validates the candidate task's owned behavior.
- When the candidate task is the final task in the story, extend that manual proof into the smallest honest full-story validation that still proves the story's end-to-end observable outcomes.
- When the candidate task is the final task in the story, prefer capturing scratch proof that later closeout can curate honestly into `codeInfoStatus/manual-proof/<story-number>/`, including screenshots, console or network captures, and runtime log evidence that map back to the story acceptance criteria.
- When the candidate task is the final task in the story and it re-covers a visual surface already shown by earlier scratch screenshots, treat the goal as capturing the latest honest proof for that surface rather than preserving every earlier screenshot by default.
- When the candidate task is the final task in the story, record in the implementation notes whether this pass re-covered the relevant story-owned visual surfaces in their current final state and whether the latest screenshots should supersede earlier screenshots for those same surfaces.
- If some earlier screenshots still remain uniquely necessary because this pass did not honestly re-prove a required surface, record that limitation briefly by surface or reason in the implementation notes instead of guessing.
- If one proof path contaminates later runtime state and a smaller supported proof path already demonstrated the candidate task's required behavior, stop at the smaller successful proof and record the later-task limitation as a concise implementation note rather than escalating it into a blocker.

</execution_rules>

<outcome_rules>

- When manual testing cannot proceed normally, classify the reason into exactly one of these buckets before deciding what to do:
  - `not_applicable`:
    - the candidate task has no relevant runnable, browser-visible, network-visible, or otherwise externally observable proof surface that its own exit criteria require;
    - in this case, record that manual testing was assessed as not applicable and continue without blocker;
    - if the candidate task has no unchecked subtasks, no unchecked testing steps, and no live standalone `**BLOCKER**`, set its `Task Status` to `__done__` before finishing.
  - `recoverable_runtime_trouble`:
    - the required proof surface should already exist, but the current runtime instance is stale, the documented startup path was not followed yet, readiness is not yet established, or a narrow in-scope startup or environment issue still looks credibly repairable in this step;
    - in this case, do one bounded recovery pass before considering a blocker.
  - `structural_proof_gap`:
    - the candidate task's required proof surface cannot honestly be exercised because a prerequisite runtime, harness, startup contract, environment contract, dependency contract, or other enabling capability is unavailable;
    - in this case:
      - perform at most one single bounded recovery/diagnosis pass using only obvious, supported, low-complexity adjustments;
      - if that pass restores the proof surface, continue manual testing normally;
      - if the proof surface is still unavailable after that same single pass, keep the classification as `structural_proof_gap` and choose exactly one outcome:
        - record a real `**BLOCKER**` only when the missing capability is within the active plan/task repair scope and this workflow is expected to repair it now using supported repository workflows; or
        - use the documented skip path below when that is not true.
- The need to inspect or start a supporting repository outside the story's declared repository list is not, by itself, a `structural_proof_gap`.
- Classify a blocker only when the required proof path remains genuinely undiscoverable, unreadable, or unsupported after bounded investigation.
- If `AGENTS.md` or, if it exists, `codeinfo_markdown/repository_information.md` defines a repository-specific skip condition and that condition is what currently prevents part of the manual proof, honor that repository policy. In that case, record the skipped surface honestly, do not reopen or fail the task for that reason alone, and do not add implementation work, blockers, or planner repair work for that reason alone.
- Under `structural_proof_gap`, also allow this general structural/environmental documented skip outcome: after that same single bounded recovery/diagnosis pass, if the remaining proof surface is structurally or environmentally unavailable in the supported runtime, and that limitation is outside the active plan/task repair scope or cannot honestly be repaired within this step using supported repository workflows, treat the outcome as a documented skip rather than a blocker.
- Do not treat that documented skip as a fourth classification bucket; it is an allowed outcome under `structural_proof_gap`.
- Do not perform a second recovery pass or a separate second diagnosis pass for that documented skip outcome; use the same single bounded recovery/diagnosis pass already required above for `structural_proof_gap`.
- That pass may include only obvious, supported, low-complexity adjustments such as:
  - restarting the documented runtime;
  - using another repository-documented supported variant;
  - using a paired repository or companion surface already supported by repository evidence;
  - refreshing a stale but repairable prerequisite;
  - or using a documented wrapper or startup path that better matches the proof surface.
- Do not invent new harnesses, ad hoc runtime variants, unsupported mounts, or broad environment surgery.
- Before using the general structural/environmental skip condition, that same bounded recovery/diagnosis pass must identify:
  - the exact surface that could not be tested;
  - one concrete example request, route, or user action that was attempted;
  - the observed result;
  - and the reason that fuller proof was not possible in this step.
- When manual testing is skipped under either a repository-defined skip condition or the general structural/environmental skip condition:
  - add one concise implementation note using this shape:
    - `Manual testing skipped for <surface>.`
    - `Tried: <simple example action/request>.`
    - `Observed: <what happened>.`
    - `Why fuller proof was not possible: <plain-English reason>.`
  - do not add implementation work, do not add `**BLOCKER**`, and do not reopen the task for that reason alone.
  - if no other incomplete work remains, keep the task `__done__` or set it to `__done__`.

- If you can honestly prove the candidate task's own changed behavior, but a later-task-owned surface prevents additional convenience, observability, cleanup, or exploratory checks, do not add `**BLOCKER**`.
- Instead, add a concise implementation note stating:
  - what was successfully proved;
  - what additional proof you intentionally did not require because it depends on later planned functionality or out-of-scope surfaces;
  - why that limitation does not invalidate the candidate task's own exit criteria.

- If manual testing reveals an issue, do a bounded diagnosis pass before mutating the task.
- If `Design Contract Present` is true, treat any `material mismatch` against a mandatory visual invariant as an issue that manual testing has revealed, even when the underlying behavior still works.
- When `Design Contract Present` is true, determine that material mismatch from the current task's explicit requirements first, then from the story plan or `Design Contract`, then from paired design markdown, and only then from the supporting visual asset when the higher-precedence sources are silent.
- That diagnosis pass must:
  - re-read the relevant task requirements and the changed proof surface;
  - inspect the relevant logs, console output, network failures, screenshots, or API responses;
  - inspect the most likely local code paths that own the observed failure;
  - rerun the smallest honest repro path;
  - if needed, add temporary diagnostic log lines or other minimal instrumentation, restart the affected runtime, and rerun the repro a small bounded number of times.
- Remove purely temporary diagnostic instrumentation before finishing this step unless it is genuinely useful production or test logging.
- Do not add speculative follow-up subtasks before that diagnosis pass is complete.
- Before adding any follow-up subtasks for a visual discrepancy, run `python3 "$CODEINFO_ROOT/scripts/plan_status.py" --include-tasks`, then use `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --all-tasks --section Overview --section Non-Goals` to inspect only the ownership descriptions of remaining open tasks.
- If a later open task already clearly owns that same visual discrepancy or comparison gap, record that it is already planned and do not add duplicate subtasks or reopen the current task solely for that already-owned work.

<section_ownership_rules>

- Any task structure added or rewritten by this step MUST follow this section contract:
  - `Subtasks` for implementation work, proof-authoring work, documentation updates, config changes, and explicitly allowed code-hygiene work that the coding agent can complete before formal proof runs.
  - `Testing` for automated proof execution only.
  - `Manual Testing Guidance` for optional, non-blocking, checkbox-free guidance for the later `manual_testing_agent` pass only when useful.
- Do not add manual-testing work to `Subtasks`.
- Do not add manual-testing checklist items in `Subtasks` or `Testing`.
- Do not add subtasks that depend on future screenshots, logs, later manual-testing-agent reruns, or later automated-proof outputs in order to become complete.

</section_ownership_rules>

- If manual testing reveals issues that require more implementation work:
  - only add new subtasks if the diagnosis pass identified a concrete failing seam, owner, or contract mismatch;
  - only add new subtasks when that issue is not already clearly owned by a later open task in the active plan;
  - update that same candidate task by adding new unchecked implementation or proof-authoring subtasks for the required follow-up work;
  - write every newly added subtask with the same level of detail and local context as the existing tasking;
  - make every newly added subtask name the exact file, harness, route, component, test file, marker, fixture, screenshot-path convention, or other prepared proof surface to change and the exact behavior to fix or prove;
  - do not add vague subtasks such as `investigate X`, `debug Y`, or `look into Z` unless the task is explicitly being reshaped into a bounded diagnostic task by planner repair;
  - when an issue can realistically be covered by automated proof, add a separate new unchecked proof-authoring subtask for that one automated test change;
  - each new automated proof-authoring subtask must cover exactly one automated proof addition or update, name the exact test file, harness, marker, fixture, screenshot-path convention, or other prepared proof surface to create or edit, and explain what behavior it must prove;
  - if a suitable automated proof addition is not realistically possible, do not invent one; instead add an implementation note stating why automated proof could not honestly be added for that manual finding;
  - update the task's `Testing` section only when the existing harness-level testing steps would not already run the new automated proof;
  - keep any added or updated `Testing` section steps at the harness or wrapper level only and never add narrow individual-test execution steps there;
  - do not add manual testing, Playwright MCP, browser-driven agent validation, screenshot review, or any other manual-proof step to the task's `Testing` section;
  - if extra later manual-testing-agent validation will still be useful after the fix, add optional `Manual Testing Guidance` instead of a blocking checklist item, and keep any supporting narrative concise in implementation notes;
  - when the repository workflow expects lint, format, or static-analysis checks as subtasks, add separate final unchecked subtasks for those code-hygiene commands;
  - set that candidate task's `Task Status` back to `__in_progress__`;
  - do not leave the candidate task `__done__` once any new unchecked subtask or testing step has been added;
  - when manual testing raises a live blocker or otherwise finds follow-up work that must be repaired before a later manual retest, reopen automated proof immediately instead of leaving the task fully checked;
  - prefer reopening the last currently checked item in the task's existing `Testing` section so the normal automated-proof loop must rerun before later manual retest;
  - if the task has no `Testing` section or no currently checked automated testing item to reopen, add a `Testing` section when needed and add exactly one new unchecked automated formatting or format-check item using a real repository-supported command that fits the owning repo or workspace, for example the relevant `format:check` command already defined in `package.json`;
  - when choosing that fallback formatting item, use the closest honest command for the task owner:
    - root or cross-workspace task: `npm run format:check`;
    - client-owned task: `npm --workspace client run format:check` or the existing wrapper-equivalent if the repository has one;
    - server-owned task: `npm --workspace server run format:check` or the existing wrapper-equivalent if the repository has one;
  - do not invent a fake rerun marker, fake testing seam, or manual-only testing checkbox just to force the loop forward;
  - add an implementation note stating that manual testing was run, the key issues found, that new subtasks or testing steps were added, and that the affected testing steps were reopened or newly added because automated proof must rerun before later manual retest;
  - if a new fallback formatting-check item was added because no honest existing automated proof item could be reopened, state that reason explicitly in the implementation note.

- If the diagnosis pass does not identify a concrete next fix honestly:
  - do not invent speculative subtasks;
  - if the situation is a `structural_proof_gap`, follow the `structural_proof_gap` decision rule above;
  - if the situation is not a `structural_proof_gap`, treat the outcome as a real blocker on the candidate task because manual testing found a task-owned failure but bounded diagnosis still could not reduce it to an honest concrete next fix in this step;
  - only record `**BLOCKER**` and set that candidate task's `Task Status` to `__in_progress__` when that rule leads to a real blocker outcome;
  - when a real blocker is recorded, include:
    - the failing manual repro;
    - what was inspected;
    - what temporary instrumentation or restarts were tried;
    - what remains unknown;
    - and what evidence is still missing.

- If manual testing succeeds without finding further work:
  - set the candidate task's `Task Status` to `__done__`;
  - add an implementation note stating whether this pass was task-scoped or full-story proof, which visible acceptance-relevant outcomes were proved, whether screenshots were captured or honestly attempted, where the scratch proof artifacts were saved under `codeInfoTmp/manual-testing/<story-number>/<task-number>/`, whether final-task screenshots superseded earlier screenshots for any re-covered surfaces or earlier screenshots remained uniquely necessary, and that no additional subtasks were needed.

- If the non-run reason is `recoverable_runtime_trouble`:
  - prefer continuing manual testing if possible instead of blocking immediately;
  - perform one bounded recovery pass before adding `**BLOCKER**`;
  - that recovery pass must:
    - stop any stale or freshness-unknown running stack that would contaminate honest proof;
    - restart the required surface using the documented workflow;
    - repair only narrow in-scope runtime or environment issues that are realistically fixable in this step;
    - rerun the smallest honest proof path for the candidate task;
  - if that recovery pass restores the proof surface, continue manual testing normally and do not add `**BLOCKER**`;
  - if that recovery pass exhausts cleanly and the proof surface remains unavailable, reclassify the outcome as `structural_proof_gap`.

- If the non-run reason is `structural_proof_gap`, apply the `structural_proof_gap` decision rule above.

- If manual testing does not run for any reason, add one concise implementation note stating whether it was skipped or assessed as not applicable, and why, unless that exact latest-loop outcome is already recorded and would be duplicated.
- When the outcome is a repository-defined skip or the general structural/environmental skip, use the required simple note shape from the skip-condition rule above.
- Keep the implementation notes concise.
- If you make tracked changes in this step, you MUST commit them, but do not push.

</outcome_rules>

<output_contract>

- Report which candidate task you evaluated.
- Report whether manual testing was skipped, assessed as not applicable, run successfully, or blocked.
- Report whether the pass stayed task-scoped or expanded to full-story proof.
- Report whether the task was eligible for manual testing because it was fully checked and unblocked.
- Report whether new subtasks or testing steps were added.
- Report whether the task status changed back to `__in_progress__` or forward to `__done__`.
- Report whether story-level guidance was present and whether it was applied.
- Report whether task-level guidance overrode any story-level direction.
- Report any supporting repositories outside the declared story repository list that were used for proof and why they were needed.

</output_contract>

<verification_loop>

- Confirm you used the stored handoff and runtime-research scope as the starting context and expanded beyond it only when honest manual proof needed supporting repositories.
- Confirm you used the task already resolved into `current-task.json`.
- Confirm you read story-level `Story Manual Testing Guidance` when it was present.
- Confirm you read the bound task's `Manual Testing Guidance` when it was present.
- Confirm candidate eligibility was determined from checklist and blocker state rather than `Task Status` alone.
- Confirm you did not require later-task-owned surfaces unless the candidate task explicitly depended on them.
- Confirm any failure-triggered follow-up work came after a bounded diagnosis pass rather than from first-guess speculation.
- Confirm any non-run outcome was classified as `not_applicable`, `recoverable_runtime_trouble`, or `structural_proof_gap` before finalizing.
- Confirm any new subtasks and proof-authoring subtasks are detailed enough for a weak junior agent to follow.
- Confirm no vague `investigate` or `debug` subtasks were added unless planner repair explicitly turned the work into a bounded diagnostic task.
- Confirm no manual-testing work was added to `Subtasks`.
- Confirm no manual-testing step was added to the task's `Testing` section.
- Confirm no newly added subtask depends on future manual-testing-agent or automated-proof outputs.
- Confirm any added `Manual Testing Guidance` is optional, non-blocking, and checkbox-free.
- Confirm that any blocker or follow-up finding discovered during manual testing reopened the final honest automated proof path by either unchecking the last checked `Testing` item or adding one real repository-supported formatting-check item when no checked item existed.
- Confirm a fully checked unblocked `__in_progress__` task was not incorrectly skipped.
- Confirm the task was set to `__done__` when manual testing succeeded or was honestly not applicable and no further work remained.
- Confirm the pass expanded to full-story proof when the candidate task was the final task in the story, unless no honest runnable proof surface existed.
- Confirm manual-proof artifacts were routed to `codeInfoTmp/manual-testing/<story-number>/<task-number>/` for the bound task rather than split between separate non-final and final-task destinations.
- Confirm Playwright MCP screenshots were not expected to save directly into the target repository; confirm they were transferred from the Playwright output directory or its harness-visible bind into the target repository destination.
- Confirm missing screenshots alone did not create duplicate subtasks, blockers, or task reopen work when the agent honestly attempted capture and recorded any limitation.
- Confirm the final-task implementation note, when applicable, recorded whether latest screenshots superseded earlier screenshots for re-covered surfaces or why earlier screenshots remained uniquely necessary.
- Confirm any visual-discrepancy follow-up work was de-duplicated against later open tasks before new subtasks were added.
- Confirm any task-overrides-story decision was recorded honestly.
- Confirm any conflict between story-level or bound-task `Manual Testing Guidance` and fresher repository evidence was recorded honestly.
- Confirm every non-run outcome left a short implementation note unless that same latest-loop outcome was already recorded.
- Confirm a bounded recovery pass was attempted before using the general structural/environmental skip condition.
- Confirm the recorded skip note includes a simple example of what was attempted, what happened, and why fuller proof was not possible.
- Confirm the general structural/environmental documented skip was treated as an outcome under `structural_proof_gap`, not as a separate classification bucket.
- Confirm no second bounded recovery pass was performed for the documented skip outcome.

</verification_loop>
