# Completed Review Fix Task Contract

Read and follow `review-created-task-timestamp.md` for every newly created completed-review-fix task.

Use this contract at the end of each immutable review batch whenever either review repair agent committed one or more fixes. Complete-pass settlement consumes the same contract to reconcile, repair, or recover the record.

## Purpose

Create one durable completed plan task that records the changes already implemented for that batch. This is historical implementation evidence, not new work and not a substitute for the final whole-story revalidation task.

Create no completed-review-fix task for a batch with no repair commit.

Create or update the record in the final batch-outcome step, after the outcome evidence is written and before that batch returns. Complete-pass settlement is the idempotent recovery boundary when an earlier outcome step was unavailable or left an understandable omission; it is not the first expected writer.

## Identity And Ordering

Use the immutable review-batch ID as the task identity. The title is:

```markdown
### Task <n>. Record Review Fixes From Batch <review-batch-id>
```

For each fix-bearing batch, create or update exactly one matching task. Never duplicate a batch record when settlement or its audit reruns.

Order completed-review-fix tasks by factual batch launch order. Place them before any open implementation tasks created for findings that remained after both repair opportunities, and place the one final revalidation task after all completed and open review-created work.

## Required Task Shape

The task must be `Task Status: __done__` and contain:

- `Review Task Role: completed_review_fixes`;
- the exact review-batch and review-cycle IDs;
- one immutable `Created` point immediately above `Overview`, produced at first task creation under `review-created-task-timestamp.md`;
- a concise `Overview` describing the already completed batch repair;
- one administrative `Repository Name`;
- `Affected Repositories` naming every repository changed in the batch;
- `Review Harnesses` naming every discovered harness that generated or corroborated the addressed findings;
- `Addresses Findings` with each finding's stable identity, plain-language summary, and owning repository;
- `Subtasks` containing only checked items that describe the repair work already completed;
- `Testing` containing only checked runnable focused proof commands that actually ran;
- and `Implementation Notes` recording the normal and stronger repair contributions, changed files when available, exact full commits per repository, proof results, limitations, and the batch evidence used.

If no focused test ran for a repair, do not invent or check a test. Record that limitation as checkbox-free prose in `Testing` or `Implementation Notes`; final revalidation remains responsible for broad proof.

Use one task for the whole batch even when fixes span repositories or both repair agents. `Affected Repositories`, not the administrative `Repository Name`, defines its evidence scope.

## Evidence And Best Effort

Discover fix evidence from the batch outcome, normal and stronger repair audits, current Git state, and referenced job evidence. Interpret self-describing artifacts by meaning and tolerate understandable shape or filename differences.

Do not claim a fix, commit, test, repository, harness, or finding that the evidence does not support. When evidence is incomplete, preserve the honest limitation in the completed task and let the settlement audit repair any recoverable omission.

## Update Rules

When the matching task already exists:

- preserve its task number and completed status;
- preserve its exact original `Created` value and placement;
- merge newly discovered repositories, harnesses, findings, commits, tests, and limitations;
- remove factual duplication;
- keep every historical checkbox checked only when evidence proves the work ran;
- and never reopen it merely because final revalidation remains.

Before completing settlement, verify that the number of completed-review-fix tasks equals the number of fix-bearing immutable batches and that every exact batch ID appears once.
