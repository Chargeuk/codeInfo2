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

## Manual Testing Skip Policy

Repository-owned files may define when manual testing can be narrowed or skipped for this repository.

For this repository:

- Manual testing may be skipped only when a documented repository-owned skip condition is being met while manual proof is attempted.
- One such skip condition is missing provider login or auth state when restoring that login would require human-controlled two-factor authentication.
- When that skip condition is met:
  - skip only the affected auth-dependent manual-proof surface;
  - do not attempt `Re-authenticate` during autonomous manual proof;
  - do not reopen or fail the task for that reason alone;
  - do not add implementation work, blockers, or planner repair work for that reason alone; and
  - rely on automated tests and mocks for the affected auth-dependent seam.
- If the provider is already logged in and the behavior still fails, treat that as a normal code or runtime issue rather than as an allowed manual-testing skip.
