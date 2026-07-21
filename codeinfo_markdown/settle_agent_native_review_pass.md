# Settle the complete agent-native review pass

Read the active review-cycle state, then locate its immutable review-pass directory under `codeInfoTmp/reviews/`. Discover every batch under `batches/` in order. Read every batch reconciliation, disposition, direct-fix audit, and outcome, reopening job evidence where necessary. Read current Git and bounded plan state.

Decide which of these outcomes is true:

1. The complete pass produced no fixes, no task-required findings, and no unresolved actionable review issue: record a clean no-work closeout.
2. Direct fixes occurred but no finding requires its own task: add or update one final testing/revalidation task after all current work.
3. Findings require implementation tasks: create those tasks with clear evidence and target ownership, improve their scope and testing, and add one final testing/revalidation task after them.

Unavailable review coverage must remain visible and be judged with best effort; it must not erase sibling findings or stop the flow. If the capability gap itself is actionable, task it. If it is not actionable within the story, record the residual uncertainty rather than creating an endless retry.

Write a self-describing settlement recommendation under the review pass's `settlement/` directory. Identify the exact plan work required, but leave plan mutation to the following tasking step so the recommendation can be independently consumed. Do not run another review here.
