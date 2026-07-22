# Settle the complete agent-native review pass

Read the active review-cycle state, then locate its immutable review-pass directory under `codeInfoTmp/reviews/`. Discover every batch under `batches/` and every factual launch record under `attempts/` in order. Read every batch reconciliation, disposition, normal and stronger repair audit, and outcome, reopening job evidence where necessary. A launch record without a batch directory is unavailable coverage, not evidence that no review was attempted or that the pass was clean. Read current Git for every target repository and bounded plan state. Interpret incomplete or imperfect self-describing evidence semantically, repair understandable derived omissions with best effort, and never require exact repair filenames, schemas, reviewer counts, or scheduling-group identities.

Before recommending plan work, read `$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md` and `$CODEINFO_ROOT/codeinfo_markdown/task_up/09-proof-and-testing.md`. Any final revalidation task must place only runnable automated proof commands in `Testing`. Put optional browser, agent-driven, screenshot, or other manual scenarios in checkbox-free `Manual Testing Guidance`; manual proof is never an unchecked automated gate or a live blocker.

Decide which of these outcomes is true:

1. The complete pass produced no fixes and no unresolved actionable review issue: record a clean no-work closeout.
2. Either repair agent committed fixes but no finding remains after both repair opportunities: add or update one final testing/revalidation task after all current work.
3. Findings remain after the normal and stronger repair opportunities: create those tasks with clear evidence and target ownership, improve their scope and testing, and add one final testing/revalidation task after them.

Do not create a task merely because disposition predicted that a finding might need one. Task only the deduplicated actionable remainder after the stronger attempt, or after that stronger attempt was honestly unavailable or failed while work remained. A finding fixed in an earlier batch and reviewed on a later target HEAD is resolved, not task work. Preserve per-repository commits and proof so the final revalidation task covers every changed target.

Unavailable review coverage must remain visible and be judged with best effort; it must not erase sibling findings or stop the flow. If the capability gap itself is actionable, task it. If it is not actionable within the story, record the residual uncertainty rather than creating an endless retry.

Write a self-describing settlement recommendation under the review pass's `settlement/` directory. Identify the exact plan work required, but leave plan mutation to the following tasking step so the recommendation can be independently consumed. Do not run another review here.
