# Goal

Establish the shared operating contract for the full `task_up2` workflow before generating or rewriting tasks.

<instruction_priority>

- Follow `AGENTS.md` for the current repository and any participating additional repository.
- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/story_behavior_lock.md"`.
- Follow `"$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md"` for the repository-agnostic dedicated final validation task contract.
- Treat this command as an autonomous tasking pass.
- Do not ask the user follow-up questions unless blocked by information that cannot be retrieved from repository files, git state, MCP tools, or official documentation.
- Keep the selected story in scope and aligned to the KISS principle.
  </instruction_priority>

<workflow_contract>

- Use fresh disk reads and current git state, not conversational memory.
- Complete each pass before moving to the next one; do not skip later traceability or testing audits because an earlier draft “looks good enough.”
- Keep using tools until the pass is complete and verified. If a lookup returns empty, partial, or suspiciously narrow results, retry with at least one better-targeted fallback before concluding there is no evidence.
- Prefer repository evidence first, then official documentation, then broader web research when needed.
- Preserve existing valid task structure and detail when rewriting; improve it rather than flattening it.
- Treat the story's planned user-facing behavior changes as locked scope, not as suggestions that tasking may reinterpret.
  </workflow_contract>

<portability_and_test_boundary_contract>

- Never write full absolute filesystem paths into tasks, subtasks, testing steps, manual-testing guidance, or documentation references.
- Use repository-relative paths, workspace-relative paths, repository aliases, command names, environment-variable names, or other portable lookup directions instead.
- Never plan production-code changes whose only purpose is to disable, bypass, mock, or weaken real production behavior so automated or manual tests can run.
- When tests need alternate auth, seeded identities, mocked providers, bypassed 2FA, or similar test-enablement seams, keep that enablement in test-only code, fixtures, harnesses, or test configuration rather than in the shipped production code path.
- Automated-test screenshots and similar generated proof artifacts must be written only to ignored artifact locations and must never be planned as checked-in repository files.
- If manual testing will write task-level proof artifacts into `codeInfoTmp/` and `.gitignore` does not already ignore that scratch path, plan the minimal `.gitignore` update needed before later proof depends on it.
- Manual-testing proof paths must stay repository-relative and use this split:
  - for any task, manual-testing screenshots, logs, and similar proof artifacts belong in `codeInfoTmp/manual-testing/<story-number>/<task-number>/` and must not be committed;
  - for story closeout, the later curated durable bundle belongs in `codeInfoStatus/manual-proof/<story-number>/`.
- When Manual Testing Guidance mentions Playwright MCP screenshots, do not imply that Playwright MCP writes directly into the target repository. State that screenshots are first captured with a relative staging path in the Playwright output directory, then transferred into the target repository artifact destination. For the codeInfo2 local harness workflow, any Playwright MCP artifact saved under `/tmp/playwright-output/<relative-path>` inside the local Playwright MCP runtime will appear at `$CODEINFO_ROOT/playwright-output-local/<relative-path>` on the host, so generated guidance should normally direct the later manual tester there first while still treating `CODEINFO_ROOT` as the harness root rather than the target artifact root unless the active plan is in the harness repository. If later manual proof needs runtime handoff JSON to resolve artifact source, fallback runtime, or destination details, tell the reader to inspect that JSON for the needed information by meaning rather than by exact property names. If screenshot transfer is still blocked after using the best supported artifact path, tell the later manual tester to record the limitation honestly rather than treating it as a reason to halt the proof loop. For visual stories, generated final-task Manual Testing Guidance should normally ask for screenshots that prove the current final state of all story-relevant visual surfaces. Earlier task screenshots are scratch proof by default and should be treated as superseded when the final task re-proves those same surfaces, while earlier screenshots remain relevant at closeout only when they still provide unique proof not re-covered later.
- If the story needs a durable reviewer-facing PR summary artifact, place it at `codeInfoStatus/pr-summaries/<story-number>-pr-summary.md` rather than under `planning/`. The executable plan remains the source of truth; the PR summary is a derived close-out artifact.

</portability_and_test_boundary_contract>

<section_ownership_contract>

- Use this section contract everywhere in this workflow:
  - `Story Manual Testing Guidance`, when present as a story-level section above `# Tasks`, contains optional story-scoped guidance for later manual testing or story QA. It must stay checkbox-free and non-blocking, and it may name paired or supporting repositories that are useful for later manual proof.
  - Substantive tasks' `Subtasks` contain only implementation work, proof-authoring work, documentation updates, config changes, and explicitly allowed code-hygiene work that the coding agent can complete before formal proof runs. The dedicated final task is the exception: it starts with exactly the lint and formatting subtasks defined by the final-task contract.
  - `Testing` contains only automated proof execution steps that the coding agent can run with repository-supported wrappers, commands, or harnesses.
  - `Manual Testing Guidance` contains optional, non-blocking guidance for the manual testing agent. It must not contain checkboxes, pass/fail gating language, or any requirement that blocks task completion.
  - Task-level `Manual Testing Guidance` may refine or override story-level `Story Manual Testing Guidance` for that one task when needed, may name paired or supporting repositories for task-specific proof paths, must not contradict fresher repository truth, and should carry forward any relevant repository-defined manual-testing skip or narrowing conditions from `AGENTS.md` or `codeinfo_markdown/repository_information.md` when those conditions affect that task's honest proof path.
- These manual-testing guidance sections help the later `manual_testing_agent`, but they do not strictly limit which supporting repositories the manual tester may investigate when honest proof requires more context.

</section_ownership_contract>

<behavior_scope_rules>

- Tasking must decompose the already-approved story behavior scope, not expand it.
- Do not create a task, subtask, testing step, or manual-testing expectation that changes established user-facing behavior unless that change is explicitly listed in the story's approved behavior changes or explicitly approved later by the user.
- If the proposed work would alter an established user interaction pattern or workflow contract, preserve current behavior unless the story explicitly requests that change or the user explicitly approves that scope expansion later.
- If a pre-existing bug, awkward workflow, inconsistency, limitation, or surprise is discovered during tasking, do not convert it into current-story implementation work unless the story explicitly requires that fix.
- If proof seems to require a behavior change, preserve current behavior and treat the issue as out-of-scope for the current story instead of tasking the behavior change into the current story.
- Do not create a numbered task or blocker for that out-of-scope behavior change in this story. Report the scope boundary only in step output unless the user later creates a new story or explicitly expands scope.
- Do not treat cleaner contracts, simpler automation, easier proofs, or internal consistency as valid reasons to widen story scope.

</behavior_scope_rules>

<design_contract_rules>

- A story has `Design Contract Present` when the plan explicitly names design-target assets intended as implementation references, such as final `*.png`, `*.svg`, `*.md`, a `## Design Contract` section, or a task-scoped design packet.
- If `Design Contract Present` is false, do not add design-specific tasking requirements.
- If `Design Contract Present` is true and paired design markdown plus visual design assets such as `*.png` or `*.svg` both exist for the same surface, treat the markdown as canonical only relative to that supporting visual asset, and follow the markdown when those two lower-precedence sources conflict.
- If `Design Contract Present` is true, treat the current task's explicit subtasks and explicit task-level requirements as the immediate implementation contract for that task's bounded surface.
- If the current task is silent or underspecified for a disputed visual point, fall back to the story plan or `Design Contract`, then to paired design markdown, then to the supporting visual asset.
- Only explicit task wording overrides lower-precedence design sources. Broad wording such as `match the redesign` does not override the story plan or `Design Contract`, paired design markdown, or the supporting visual asset by itself.
- If `Design Contract Present` is true, every design-driven task must name the exact design assets it owns and must not rely on vague phrases such as `match the approved design direction` without concrete visual obligations.
- If `Design Contract Present` is true, every design-driven task should include a short `Visual Invariants` subsection or equivalent concrete wording that states what must match, what may vary slightly, and what later proof must compare against the named design assets.
- If `Design Contract Present` is true, every visual implementation subtask must reference the exact design file or file subset that governs the surface it is changing.
- If `Design Contract Present` is true, the final task in the story must include `Manual Testing Guidance` that asks for full-story screenshots of all implemented frontend surfaces so later review can compare them against the named design assets.

</design_contract_rules>

<phase_dependency_contract>

- Never create a subtask or testing step that requires manual testing to have already happened.
- Never create a subtask that requires automated test execution results to become complete. The final task's lint and formatting subtasks are direct code-hygiene execution, not dependencies on later `Testing` output.
- Subtasks may name the exact proof-owning files, log markers, fixtures, screenshot paths, or harness surfaces that must be prepared, but the generated proof output itself belongs to the later `Testing` phase or to optional `Manual Testing Guidance`.
- Do not create subtasks that say or imply `run automated tests`, `after Testing step N`, or `capture proof from the later test run`.

</phase_dependency_contract>

<completeness_contract>

- Treat the workflow as incomplete until every Acceptance Criterion, important Description requirement, and meaningful failure mode has a clear place in the task list or is explicitly kept out of scope by the story.
- Treat the workflow as incomplete until every important requirement has both an implementation home and a named proof home.
- Treat the workflow as incomplete until the final task list is understandable to a weak, junior, forgetful developer who may only read one subtask at a time.
- If `Design Contract Present` is true, treat the workflow as incomplete until every named design asset has at least one task owner, explicit visual invariants, and later screenshot-comparison proof guidance.
- If `Design Contract Present` is true, treat the workflow as incomplete until the final task's manual-testing guidance covers full-story screenshot capture for the implemented frontend surfaces, not only the latest task-local screen, and clearly treats those final-task screenshots as the expected primary closeout proof for the surfaces they re-cover.
  </completeness_contract>

<missing_context_policy>

- If required context is missing, gather it from repository files, git state, MCP tools, or official documentation before asking the user.
- If a prerequisite file, repository, or branch check fails, stop and report the exact blocker rather than guessing.
  </missing_context_policy>

<output_contract>

- Return tasks in the repository's plan format only.
- Keep wording concrete, scoped, and executable.
- Do not add filler sections, vague placeholders, or generic “update tests” instructions that hide the real work.
  </output_contract>

<mini_example>

- Good: “Subtask: Update `server/src/ingest/ingestJob.ts` to defer provider initialization until embedding work exists. Purpose: preserve metadata-only fast paths when provider bootstrap fails.”
- Bad: “Subtask: Fix ingest job behavior.”
- Good: “Subtask: Extend `client/src/test/...` and the related proof marker wiring so later automated or manual validation can prove the stale-state fix.”
- Bad: “Subtask: Run Playwright and attach screenshots for the stale-state fix.”
  </mini_example>
