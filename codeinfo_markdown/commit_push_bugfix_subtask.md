# Commit and attempt one Jira bugfix push

Continue with the story and subtask bound throughout the current loop. Read and follow `AGENTS.md`. Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_next_bugfix_subtask.py"` again and inspect fresh Jira and Git state. Continue only when the same subtask remains In Progress and assigned to the current user, the branch is unchanged, and `information.md` plus `plan.md` positively show that the in-scope implementation and mandatory proof are complete.

Do not commit partial, stale, blocked, or unproven work. Preserve unrelated working-tree changes and stage only files belonging to this subtask. Never stage or commit anything under `codeInfoTmp/`; attachments, screenshots, proof decisions, generated Jira comments, and evidence Markdown there are local flow artifacts. Follow the repository's required commit-message format, including any required body. Do not amend, rewrite, squash, reset, or otherwise alter unrelated history.

If implementation-owned changes exist:

1. Review the exact staged diff.
2. Create one local commit.
3. Record its full hash.
4. Inspect the current upstream.
5. Attempt one push of the current branch to its existing remote/upstream.
6. If `information.md` already records a push attempt for that exact commit, inspect the remote but do not make a second push attempt for it.
7. Do not retry the same failed push indefinitely and do not undo a successful local commit.

If no implementation-owned change is required because the defect is already fixed, do not create an empty commit. Require explicit reproducible acceptance evidence and record the no-change conclusion.

Append or refresh an `## Commit and push evidence` section in `information.md` with the commit hash or justified no-change result, branch, upstream, the single push attempt, whether the remote contains the commit, and a concise sanitized failure when applicable. Never include credentials or secret-bearing remote URLs.

Do not close Jira in this step. A failed commit or push leaves the subtask In Progress.
