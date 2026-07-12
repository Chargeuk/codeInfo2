# Goal

Perform a final readability and execution audit so the resulting task list can be followed by a weak, junior, forgetful implementer without hidden decomposition work.

<instruction_priority>

- Rewrite vague subtasks rather than merely commenting that they are vague.
- Preserve valid technical detail while improving clarity and sequencing.
- Do not remove necessary repository ownership, proof, or edge-case detail.
- Follow `$CODEINFO_ROOT/codeinfo_markdown/shared/final-task-creation.md`. Treat the dedicated final task's deliberately minimal per-repository lint-and-format-only shape as valid rather than expanding it for implementation detail.
  </instruction_priority>

<junior_executor_rules>

- Read `$CODEINFO_ROOT/codeinfo_markdown/shared/bounded-plan-read.md` and run `python3 "$CODEINFO_ROOT/scripts/plan_sections.py" --profile review-tasking` before editing.
- When the active plan already contains tasks, limit substantive rewrites to tasks that are still `__to_do__`.
- Do not rewrite `__done__` or `__in_progress__` tasks except for minimal numbering, dependency, cross-reference, or testing-honesty fixes required to keep the plan executable and truthful.
- For each substantive task and subtask, check whether it clearly says:
  - what file, seam, or runtime surface to touch;
  - what output to produce;
  - what invariant or requirement it supports;
  - what not to change when that boundary matters.
- Split any remaining subtask that still depends on hidden senior judgment to choose the real unit of work.
- Rewrite vague verbs such as “handle,” “support,” “wire up,” or “update tests” into explicit actions with file targets and intended outcomes.
- Keep sequencing obvious: if one subtask depends on another subtask's output, order them so the implementer does not have to guess.
- Preserve the repository's testing workflow, but make sure the `Testing` section is still runnable and honest at the point the task is supposed to complete.
- Preserve any review-preemption subtasks added by earlier passes unless repository evidence shows they are genuinely not applicable.
- Check whether a weak coding agent could honestly complete every subtask before formal proof runs, without browser MCP tools, manual validation, or later executed proof artifacts.
- Check whether any subtask still depends on future automated or manual testing output. If so, rewrite it.
  </junior_executor_rules>

<verification_loop>

- Check whether a junior developer could execute each subtask without reading the whole story first.
- Check whether any subtask still hides multiple decisions behind one checkbox.
- Check whether the final validation task has the required repair-scope note first in both `Subtasks` and `Testing`, exactly one lint and one formatting checklist item per worked-on repository, and a concrete repository-evidenced build, applicable startup, full-suite, and matching shutdown sequence for every worked-on repository.
  </verification_loop>

<output_contract>

- Rewrite tasks and subtasks directly where needed.
- Keep the final task list concrete, junior-friendly, and repository-accurate.
  </output_contract>
