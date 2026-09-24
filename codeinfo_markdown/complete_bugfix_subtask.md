# Close the proven Jira bugfix subtask

Evaluate completion only for the story and subtask durably bound throughout this loop. Read and follow `AGENTS.md`. Never run the next-work selector or adopt a different issue.

Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_bound_bugfix_subtask.py"` and reread that exact bound Jira issue directly, its `information.md`, `plan.md`, current Git state, commit history, configured upstream, and test evidence. If Jira already closed the bound subtask, verify its resolution and stop without touching another issue. Otherwise, continue only when the helper returns `status: "ready"` for the same In Progress subtask and reports `assigned_to_current_user: true`.

Transition the bound subtask only when all applicable facts are positively established:

- The planned fix is complete and acceptance criteria are addressed.
- Mandatory focused and broader proof passed without an implementation-caused failure.
- Every affected component has current successful build, startup, and readiness evidence, plus applicable cleanup and runtime-restoration evidence, except for a narrowly accepted Dev-only verification condition described below.
- No material blocker or uncertainty remains.
- Implementation-owned changes are committed, or a no-change result is explicitly and reproducibly justified.
- For a code-changing fix, the configured remote/upstream contains the completed commit.
- `frontend-proof.json` is valid; when it requires frontend proof, current local screenshots exist, were inspected, and were successfully uploaded to this subtask, except for a narrowly accepted Dev-only verification condition described below.
- The explanatory Jira completion comment was successfully created and independently verified for this subtask.
- Jira still shows the bound subtask assigned to the current user and In Progress.

Dev-only verification is a narrow exception to local runtime and screenshot proof, not to implementation quality, automated checks, Git publication, Jira publication, or disclosure. It permits closure without conclusive local runtime or screenshot proof only when every applicable fact below is positively established:

- The behavior can be conclusively verified only in Dev because it depends on deployment-only infrastructure, configuration, topology, traffic, or observability that cannot be faithfully reproduced locally.
- `plan.md` and `information.md` record the exact reason, the concrete Dev verification condition, and every reasonable best-effort local attempt.
- All safe and locally applicable tests, builds, linting, formatting, Prettier, startup, readiness, smoke, and cleanup checks were attempted; every available mandatory automated check passed.
- Any unavailable or failed local runtime or screenshot evidence is explained by the Dev-only limitation, and no result indicates an implementation-caused failure.
- The verified Jira completion comment plainly states what was and was not proven locally and what must be checked in Dev.

Do not accept Dev-only verification merely because local proof is slow, difficult, inconvenient, transiently failing, or uncertain. Do not claim the missing proof passed. When the narrow exception is fully supported, the absence of that local proof alone must not keep the subtask In Progress.

If any other applicable fact is missing, failed, stale, partial, contradictory, or uncertain, leave Jira In Progress and report the blocker. A local commit with a failed push is not sufficient for Jira completion.

When every gate passes, use the connection from the durable binding and run exactly:

`gt jira issues update <subtask-key> --connection <connection> --status Closed --resolution Resolved`

This DEVT workflow's completed state is Closed with resolution Resolved. After the write, fetch the issue again with `gt jira issues get <subtask-key> --connection <connection> --json`. Report success only when Jira independently returns status `Closed` and `.raw.fields.resolution.name` is `Resolved`. If the transition or verification fails, preserve all completed Git work, leave the failure explicit, and do not retry indefinitely or modify another issue.
