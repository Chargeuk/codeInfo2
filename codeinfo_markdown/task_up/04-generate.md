# Goal

Create or rewrite the task list so it is specific, sequenced, and executable by a junior developer without hidden assumptions.

<instruction_priority>

- Follow the shared workflow contract from `"$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md"`.
- Work from the active plan only.
- Do not leave investigation subtasks in the task list; investigations must be resolved now through the earlier research passes, repository evidence, and documentation.
- Prefer the smallest set of tasks that fully implements the story without combining unrelated work.
  </instruction_priority>

<source_priority>

- Use `code_info` first for repository facts, existing implementations, reusable patterns, contracts, likely file locations, cross-repository relationships, and how we or our company already solve similar problems across ingested repositories. Include the full repository path when asking about this repository.
- Inspect relevant local source files directly after `code_info`.
- If `repository_information.md` was found during preflight, use it as supporting product and repository context throughout this pass.
- Use DeepWiki for external GitHub repository architecture or docs when relevant.
- Use Context7 for library, SDK, and framework documentation when relevant.
- Use web search only when repository evidence plus official docs do not settle an external-library or runtime question.
  </source_priority>

<task_generation_rules>

- If the story has no tasks, create them.
- If the story already has tasks, rewrite them where needed so they match the tasking rules below.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`: after all substantive implementation tasks, append one dedicated final validation task with the required repair-scope note at the top of both `Subtasks` and `Testing`; only each worked-on repository's independently discovered supported lint and formatting items in `Subtasks`; and its discovered full build, applicable startup, relevant full suites, matching shutdown, supported lint, and supported formatting in `Testing`, omitting unsupported commands.
- Each task must implement exactly one primary seam that can be tested as a coherent unit.
- Each task must belong to exactly one repository.
- If the story spans multiple repositories, split provider-repository and consumer-repository work into separate tasks and make the sequencing explicit.
- Add explicit task dependencies whenever a task relies on another task's output, contract, harness, migration, or shared library change.
- Keep prerequisite work earlier than downstream tasks that depend on it.
- Add cleanup or removal tasks when the story replaces or supersedes existing behavior.
- Add migration or compatibility tasks when the story changes contracts, storage, env vars, build/runtime wiring, or deployment behavior.
- Add explicit implementation and proof-authoring work when the story changes env/config inputs with constrained domains, including invalid-input, blank-input, and oversized-input handling.
- Add explicit implementation and proof-authoring work when the story introduces or changes query/filter/bulk-selector logic that must stay bounded as repository or file counts grow.
- Add explicit implementation and proof-authoring work when the story changes reader and writer behavior over the same persisted artifact, including partial-state handling and cleanup ownership when relevant.
- Add explicit implementation and proof-authoring work when the story changes cancellation, retry, teardown, crash-recovery, or other lifecycle-sensitive orchestration.
- For stateful orchestration stories, add or preserve a lifecycle matrix in task wording or proof mapping when it materially helps prevent missed states. Cover the relevant rows from admission, waiting, running, success, skipped or no-op, zero-work, error, cancel, cleanup failure, retry, startup recovery, and dependency outage, and map those rows to persisted state, runtime state, response or log output, blocking caller behavior, UI or repo-list behavior, and proof owners where those surfaces exist.
- Add explicit implementation and proof-authoring work when the story changes selectors, wrappers, startup paths, CI routing, or feature flags that affect whether the behavior runs in the default path.
- Add explicit implementation and proof-authoring work when changed tests or harness code depend on deterministic boundaries, teardown ordering, or shared-state safety.
- Add explicit producer-consumer contract proof when the story changes shared errors, payloads, persisted shapes, log markers, schema files, OpenAPI, documentation contracts, or transport wrappers. A route or helper proof alone is not sufficient when another surface formats, documents, wraps, or consumes the same contract.
- Add an explicit baseline or prerequisite task when repository evidence shows a broad wrapper, Compose path, runtime handoff, or shared test harness is already unhealthy or missing before the story-specific work can be proved honestly.
- For runnable or browser-visible stories, add manual runtime guidance only after the tasking has identified the supported stack, env and mount assumptions, ports, seed/setup source, and artifact destination. Do not let those runtime facts remain implicit for the manual-testing phase.
- Add observability or diagnosability work when the story would be difficult to prove or debug without it.
- Add documentation tasks only when the story actually changes documentation-relevant behavior, files, architecture, commands, contracts, or screenshots.
- When the story needs auth bypasses, seeded identities, mocked providers, alternate login flows, or similar test-enablement seams, generate that work as test-only harness, fixture, support-code, or test-configuration changes rather than as shipped production-code behavior changes.
- When manual testing for the story will write task-level proof artifacts into `codeInfoTmp/` and the current repository does not already ignore that scratch path, generate the minimal `.gitignore` update needed before later proof depends on it.
- If `Design Contract Present` is true, add explicit task ownership for the design assets:
  - assign each named design asset to at least one bounded task;
  - narrow each task to the smallest honest subset of design files it must follow;
  - add task exit criteria that include visual outcomes, not just behavioral outcomes;
  - make the relevant visual implementation subtasks cite the exact design files they are implementing;
  - when paired design markdown plus visual design assets such as `*.png` or `*.svg` both exist for the same surface, make the task reference both assets while treating the markdown as canonical only relative to the supporting visual asset.
  - if the task intentionally differs from paired design markdown for that bounded surface, state that difference explicitly in the task wording or `Visual Invariants` rather than leaving the override implicit.
  </task_generation_rules>

<task_shape_rules>

- Use the current `plan_format.md` structure.
- Every task must name its repository.
- Every task must include a concise Overview and a concrete Task Exit Criteria section.
- Except for the dedicated final validation task, every task must include a requirement-to-proof map in its subtasks: for each implemented acceptance path, name the exact code surface and the exact proof-owning file(s) or prepared proof surface(s) that will need to change. Do not require the later generated proof output itself for subtask completion. The final task consumes the proof prepared by earlier tasks and must not duplicate those proof-authoring subtasks.
- `Documentation Locations` must reference external docs, MCP docs, official URLs, or installed library code. Local repo files to inspect or change belong in Subtasks, not in Documentation Locations.
- Subtasks must name the relevant local files, folders, classes, functions, commands, configs, or runtime assets to inspect or update.
- Each subtask must be understandable in isolation for a very weak, junior, forgetful developer who may read only that one subtask and may not reliably cross-reference the rest of the plan.
- Repeat critical context, documentation references, commands, and expected outcomes inside a subtask when omitting them would force the implementer to infer missing information from other sections.
- Each documentation file update belongs in its own subtask.
- Each task should be detailed enough for a junior developer who may only read the current task and its subtasks.
- Add explicit proof-authoring subtasks whenever code must be written or updated to prove a requirement, edge case, error path, recovery path, or mixed-state path. Those subtasks must name the exact test file(s), fixtures, markers, harness files, or prepared proof surfaces to create or edit.
- If `Design Contract Present` is true, add a short `Visual Invariants` subsection or equivalent task wording for each design-driven task that lists the concrete required visual matches and any allowed implementation flex.
- When paired design markdown plus visual design assets such as `*.png` or `*.svg` both exist for the same surface, write those visual invariants from the markdown first and use the visual asset only to preserve the intended visual direction when the markdown is silent.
- When a current task intentionally restates or narrows a design requirement, carry that restated requirement directly into the task wording so implementers, testers, and reviewers can follow the task without guessing from lower-level design sources.
- If `Design Contract Present` is true, ensure the dedicated final task carries `Manual Testing Guidance` that asks for screenshots covering the full implemented frontend for the story. Keep that optional guidance outside `Subtasks` and `Testing`.
- Do not make a subtask's completion depend on executed test output, later screenshots, later logs, or later manual validation.
- When a changed behavior could leave an existing test title misleading, add an explicit subtask to rename or rewrite that proof so the stated invariant still matches the assertions.
- When a UI surface changes enablement, visibility, mode gating, or create-vs-reuse behavior, add an explicit subtask for stale-state handling and proof that disabled or hidden state is either cleared or excluded from submission.
- Do not put build or test execution commands in Subtasks unless the task is specifically creating or repairing a harness or wrapper.
- Do not put automated test execution commands in `Subtasks`.
- Do not put manual testing work in `Subtasks`.
- Except for the dedicated final validation task governed by `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`, end each non-final task's `Subtasks` section with these supported final subtasks in this order when their commands exist:
  - a lint subtask that names the exact repository-supported lint command and says to fix any issues found, using any supported auto-fix path before manual cleanup when available;
  - a formatting subtask that names the exact repository-supported formatting command and says to fix any issues found, using any supported auto-fix path before manual cleanup when available.
- Lint or formatting fixes that go beyond the narrow story scope are allowed when they are required to leave the repository in an honestly passing state.
  </task_shape_rules>

<verification_loop>

- Treat this pass as incomplete until every Acceptance Criterion, important Description requirement, and explicit Out Of Scope boundary has a plausible place in the task list or is explicitly marked out of scope by the story itself.
- Treat this pass as incomplete until each Acceptance Criterion, edge case, and meaningful failure mode has both implementation subtasks and named proof-authoring subtasks, even though the later Testing section may still execute only broad wrapper commands.
- Treat this pass as incomplete until the highest-risk invariants from the research pass have explicit implementation and proof homes, or are explicitly out of scope.
- Treat this pass as incomplete when a planned proof could pass by proving adjacent behavior while the exact ordering, propagation, default-path, or producer-consumer invariant remains untested.
- Treat this pass as incomplete until no generated subtask depends on future automated or manual proof output in order to become executable.
- If existing tasks are too large, split them only when the split improves clarity, sequencing, or proof without making the work more fragmented or less testable.
- If a still-unknown contract, runtime seam, or library behavior would force the task list to include “investigate” or “confirm” work, stop and push that clarification back into the plan instead of leaking it into the tasks.
  </verification_loop>

<output_contract>

- Update the task list directly.
- Keep titles specific and sequencing explicit.
- Do not add filler sections or placeholder tasks.
  </output_contract>
