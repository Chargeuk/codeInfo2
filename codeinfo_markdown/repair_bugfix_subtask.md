# Repair the remaining Jira bugfix blocker

This is the single allowed stronger repair attempt for the current bugfix subtask. Read and follow `AGENTS.md`. Work only in the selected repository and only on the subtask already bound by the current loop.

Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_next_bugfix_subtask.py"` and continue only when it returns `status: "ready"` for the same In Progress subtask assigned to the current user. Read that subtask's `information.md`, `plan.md`, downloaded evidence, current Git diff, and current test results.

Identify the concrete remaining implementation, test, formatting, build, startup, readiness, or shutdown blocker left by the normal coding agent. Repair only that blocker using the smallest change consistent with the existing one-shot plan. Do not expand scope, redesign unrelated code, replace the plan, switch branches, commit, push, or change Jira state.

Before returning, create or refresh a `## Stronger repair attempt` section in `information.md` that records that the subtask's single stronger invocation has been consumed, what was attempted, the checks run, and the outcome. Rerun the smallest relevant failed checks, followed by any mandatory broader checks made necessary by the repair, including affected component build and startup proof. Preserve unrelated working-tree changes. Update `## Implementation evidence` in `information.md` with the repair, proof, and any remaining blocker. If reliable evidence is missing or the blocker cannot be resolved within scope, record that honestly and stop without manufacturing completion. A later loop may recover the subtask, but it must not invoke another stronger repair when this durable attempt record is present.
