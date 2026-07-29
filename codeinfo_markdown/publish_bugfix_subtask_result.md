# Publish the Jira bugfix result and local screenshots

Continue only with the story and subtask bound throughout the current loop. Read and follow `AGENTS.md`. Do not adopt another issue, edit product source, switch branches, create another commit, push again, or close Jira during this step.

Reread the bound Jira issue directly and run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_next_bugfix_subtask.py"` only as a consistency check. Continue only when Jira still shows the bound subtask assigned to the current user and In Progress. Read its `information.md`, `plan.md`, current Git state, commit and push evidence, exact selector-provided `frontend_proof` file, and direct-child files in the selector-provided `proof` directory.

Treat only current, non-empty image files directly inside `proof/` as screenshot candidates. Do not upload downloaded Jira attachments, nested stale files, temporary browser files, logs, JSON, or unsupported files. When screenshots exist, attempt one best-effort upload call using every current image as a repeated `--file` argument:

`gt jira issues attachments add <subtask-key> --connection <connection> --file <screenshot-one> --file <screenshot-two> --json`

Do not make an upload call when there are no screenshots. Do not retry the upload indefinitely. Preserve the returned attachment IDs, filenames, and per-file outcomes when GT supplies them. An upload failure must not prevent the comment attempt.

Create or refresh the exact selector-provided `jira_fix_comment` file as a valid Atlassian Document Format document. The comment must concisely explain:

- What was wrong.
- The underlying cause.
- What changed and why the solution is correct.
- The tests, linting, formatting, and Prettier checks actually performed.
- Build, startup, readiness, and shutdown evidence.
- The branch, commit or justified no-change result, and push/upstream result.
- Browser verification and the uploaded screenshot filenames and attachment IDs when present.
- Any failed, missing, partial, or uncertain evidence, including required screenshots that could not be captured or uploaded.

Attempt exactly one comment creation for this flow iteration:

`gt jira issues comments create <subtask-key> --connection <connection> --adf-file <jira-fix-comment-path> --json`

Do not search existing comments for an idempotency marker and do not add a marker. When creation returns a comment ID, verify that exact comment directly with:

`gt jira issues comments get <subtask-key> <comment-id> --connection <connection> --json`

If creation fails or its result cannot be verified, record the uncertainty rather than retrying or claiming success.

Append or refresh an `## Jira publication evidence` section in `information.md` containing the screenshot files discovered, upload command outcome, uploaded attachment IDs and filenames when known, comment file path, comment ID and verification outcome, and any failure. The absence of screenshots is acceptable only when `frontend-proof.json` validly records `{"required":false}`. This step always attempts the explanatory comment, including for backend-only fixes.
