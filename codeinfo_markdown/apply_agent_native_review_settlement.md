# Apply the agent-native review settlement

Read the complete-pass settlement recommendation, every referenced batch and finding, current Git state, and the bounded plan.

If the pass was genuinely clean, record the no-work closeout without adding a task. If either repair agent committed fixes and nothing remains after both repair opportunities, add or update one final testing/revalidation task after all existing work. If findings remain after the stronger repair opportunity, create one or more appropriately scoped implementation tasks, improve their dependencies, exit criteria, subtasks, automated proof, manual guidance, target-repository ownership, and finding provenance, then add one final testing/revalidation task after them. Do not task a disposition prediction or a finding already fixed on a later target HEAD.

Use the repository plan helpers repeatedly to check the work. Keep task ordering and current-task handoffs valid. Update the plan continuously and make the normal implementation loop able to select the new work. Do not implement remaining findings or start another review in this step.
