# Review-Created Task Timestamp Contract

Use this contract whenever a review workflow creates a new numbered plan task. It applies to completed tasks that record fixes made during review, open implementation tasks for actionable findings that remain unresolved after repair, bounded recovery or incomplete-review tasks, minor-fix audit tasks, and final testing or revalidation tasks created because a review pass changed code or added work.

## Required Creation Point

Immediately before inserting a new review-created task, run:

```text
node "$CODEINFO_ROOT/scripts/format-display-timestamp.mjs"
```

Copy its stdout exactly into one Markdown point named `Created`, positioned immediately above the task's `Overview` heading:

```markdown
- Created: `<exact formatter stdout>`

#### Overview
```

The formatter's host-local display locale and IANA time zone are authoritative for this human-readable point. Do not substitute a review launch time, batch time, UTC machine timestamp, file modification time, commit time, or conversational estimate.

Every new review-created task must contain an `Overview`. Put task identity, status, role, repository, dependency, batch, cycle, and other compact metadata before `Created`; put review harnesses, addressed findings, exit criteria, subtasks, testing, manual guidance, and implementation notes after `Overview`.

## Identity And Preservation

`Created` records when that numbered task was first added to the plan. Preserve its exact value when settlement is retried, a matching batch task is updated, task content is improved, an audit or repair runs, dependencies change, or tasks are renumbered. Never refresh it merely because the task was revisited.

When a current review invocation has just created a task but omitted or malformed its creation point, the following semantic audit or repair must run the formatter and add the missing point before completing. Do not backfill or rewrite unrelated historical tasks that predate this contract.

Interpret the point by meaning rather than introducing a runtime schema or parser. Agents creating, updating, or auditing review-created tasks are responsible for preserving it.
