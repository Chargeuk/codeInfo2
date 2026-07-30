# Gather Jira bugfix information and attachments

Continue with the story and subtask bound in the immediately preceding claim step. Read and follow `AGENTS.md` again. Work only in the selected repository and do not switch branches, edit product source, plan the fix, commit, push, or close Jira during this step.

Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_bound_bugfix_subtask.py"` now. Continue only when it returns `status: "ready"` for the same durably bound story and subtask, reports `assigned_to_current_user: true`, and Jira still shows that exact subtask In Progress. If the binding is unavailable or Jira ownership or state changed incompatibly, stop safely instead of selecting or adopting another issue.

Use the exact repository-relative paths returned by the bound-task helper:

- `codeInfoTmp/bugfixes/<storyId>/<subtaskId>/information.md`
- `codeInfoTmp/bugfixes/<storyId>/<subtaskId>/plan.md`
- `codeInfoTmp/bugfixes/<storyId>/<subtaskId>/attachments/`
- `codeInfoTmp/bugfixes/<storyId>/<subtaskId>/proof/`
- `codeInfoTmp/bugfixes/<storyId>/<subtaskId>/frontend-proof.json`
- `codeInfoTmp/bugfixes/<storyId>/<subtaskId>/jira-fix-comment.json`

Create the root, attachments, and proof directories if needed. Preserve useful files from an earlier attempt, but refresh stale Jira-derived content. The later proof and publication steps own `frontend-proof.json`, `jira-fix-comment.json`, and screenshots; do not create or infer them here. Do not use absolute repository paths in the generated Markdown.

Gather fresh information on a best-effort basis with:

- `gt jira issues get <subtask-key> --connection <connection> --json`
- `gt jira issues get <subtask-key> --connection <connection>` for Jira field names and human-readable rendered values
- `gt jira issues comments list <subtask-key> --connection <connection> --json`
- `gt jira issues attachments list <subtask-key> --connection <connection> --json`

The attachment list is the single deduplicated GT result and may combine Jira's normal field, changelog, and rendered-content discovery. Do not attempt to identify or report which discovery source produced an attachment.

For every attachment record, retain whatever is available from `id`, `filename`, `mimeType`, and `size`. Missing fields must not exclude the record or fail the step. When an ID is available, download it with:

`gt jira issues attachments get <attachment-id> --connection <connection> --download <relative-download-path>`

Place downloads below the returned `attachments` directory. Use `<attachmentId>-<sanitizedFilename>` when both are available, remove path separators and traversal components from filenames, and use a stable safe fallback when the filename is absent. Never write outside the selected subtask directory. Do not overwrite two different attachments onto the same path.

Inspect downloaded images with the agent's image-viewing capability. Read other safe text or document attachments when useful and supported. A failed metadata request, comment request, individual download, image inspection, or unsupported file type must not discard successfully gathered evidence.

Create or refresh `information.md` with these sections:

1. `# Subtask information`
2. `## Identity and status`
3. `## Summary`
4. `## Description`
5. `## Acceptance criteria`
6. `## Key details`
7. `## Other populated Jira fields`
8. `## Comments`
9. `## Attachments`
10. `## Collection warnings`

Include the story key, bound subtask key, Jira URL when derivable, type, status, assignee, reporter, priority, creation/update timestamps, description, acceptance criteria, key details, and every other useful populated field. Render Atlassian Document Format into readable Markdown where possible. Preserve comments in chronological order with ID, author, timestamp, and readable body. If a Jira response says more comments or child records exist than GT returned, record that truncation under Collection warnings rather than claiming the collection is complete.

For each attachment, record its available metadata, repository-relative local path, download outcome, and a concise observation when it was inspected. Record partial failures under Collection warnings without inventing missing data. Also record the current Git branch, HEAD, and pre-existing working-tree changes as the implementation baseline. Do not create `plan.md` yet.
