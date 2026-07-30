# Close the proven Jira bugfix subtask

Evaluate completion only for the story and subtask durably bound throughout this loop. Read and follow `AGENTS.md`. Never run the next-work selector or adopt a different issue.

Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_bound_bugfix_subtask.py"` and reread that exact bound Jira issue directly, its `information.md`, `plan.md`, current Git state, commit history, configured upstream, and test evidence. If Jira already closed the bound subtask, verify its resolution and stop without touching another issue. Otherwise, continue only when the helper returns `status: "ready"` for the same In Progress subtask and reports `assigned_to_current_user: true`.

Transition the bound subtask only when all applicable facts are positively proven:

- The planned fix is complete and acceptance criteria are addressed.
- Mandatory focused and broader proof passed without an implementation-caused failure.
- Every affected component has current successful build, startup, and readiness evidence, plus applicable cleanup and runtime-restoration evidence.
- No material blocker or uncertainty remains.
- Implementation-owned changes are committed, or a no-change result is explicitly and reproducibly justified.
- For a code-changing fix, the configured remote/upstream contains the completed commit.
- `frontend-proof.json` is valid; when it requires frontend proof, current local screenshots exist, were inspected, and were successfully uploaded to this subtask.
- The explanatory Jira completion comment was successfully created and independently verified for this subtask.
- Jira still shows the bound subtask assigned to the current user and In Progress.

If any fact is missing, failed, stale, partial, contradictory, or uncertain, leave Jira In Progress and report the blocker. A local commit with a failed push is not sufficient for Jira completion.

When every gate passes, use the connection from the durable binding and run exactly:

`gt jira issues update <subtask-key> --connection <connection> --status Closed --resolution Resolved`

This DEVT workflow's completed state is Closed with resolution Resolved. After the write, fetch the issue again with `gt jira issues get <subtask-key> --connection <connection> --json`. Report success only when Jira independently returns status `Closed` and `.raw.fields.resolution.name` is `Resolved`. If the transition or verification fails, preserve all completed Git work, leave the failure explicit, and do not retry indefinitely or modify another issue.
