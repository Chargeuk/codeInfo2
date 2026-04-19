# Repository Information

## Harness Repository Contract

This workflow distinguishes between:

- the harness repository, which owns shared workflow assets like `scripts/**`, `codeinfo_markdown/**`, `flows/**`, and agent support files; and
- the target repository, which is the repository currently being implemented, tested, or reviewed.

`CODEINFO_ROOT` always points to the harness repository root.

It does not point to:

- the target repository root;
- the selected `working_folder`; or
- the repository that happens to own the currently checked out product code.

Use `"$CODEINFO_ROOT/..."` only for harness-owned workflow assets.

Examples:

- Correct: `python3 "$CODEINFO_ROOT/scripts/plan_status.py"`
- Correct: `read "$CODEINFO_ROOT/codeinfo_markdown/shared/current-task-handoff.md"`
- Incorrect: `cat "$CODEINFO_ROOT/src/app.ts"` when `app.ts` belongs to the target repository

When accessing target-repository files, use the target repo path, the active `working_folder`, or explicit absolute paths.
