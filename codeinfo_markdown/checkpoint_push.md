## Task

Persist the changes that already exist in every repository in the active story scope, then push them when safe. This is a checkpoint only. It is not an implementation, repair, testing, formatting, review, or story-closeout step.

## Scope

1. Read `codeInfoStatus/flow-state/current-plan.json` and use only its stored `plan_path` and `additional_repositories`.
2. Treat the current repository as in scope even when it is absent from `additional_repositories`.
3. Ignore duplicate repository entries and continue best-effort when one repository cannot be read or persisted.
4. Follow each in-scope repository's commit-message and branch rules. For optional attribution of already-authorized messages, follow the AI message attribution subsection in `$CODEINFO_ROOT/codeinfo_markdown/codeinfo2_implement_story/shared.md`.

## Non-Negotiable Checkpoint Boundary

- Do not edit, create, delete, move, format, or repair implementation, test, planning, review, proof, configuration, or documentation files.
- Do not implement any task or review finding.
- Do not change any task status, checkbox, implementation note, acceptance criterion, review result, or workflow handoff.
- Do not run tests, builds, linting, formatting, auto-fix commands, generators, installers, or any other command that may change repository content.
- Do not perform final validation or story closeout.
- Do not create an empty commit.
- The only permitted state-changing operations are staging eligible in-scope changes present in the refreshed inventory immediately before staging, committing those changes in the existing single commit attempt, and pushing the current story branch.

If work appears unfinished, incorrect, untested, or newly tasked, preserve it exactly as found. The later implementation loop owns that work.

## Procedure

For each in-scope repository, one at a time:

1. Resolve the repository path and confirm it is a readable Git repository.
2. Record the current branch, `HEAD`, and working-tree inventory before any state-changing command.
3. If the repository is on the wrong story branch, report the mismatch and skip its commit and push. If `MERGE_HEAD` exists or the index has unmerged entries, skip both commit and push for that repository, report the pending merge or unmerged index state, and continue with independent repositories.
4. Immediately before staging, refresh the inventory and stage/commit the latest eligible in-scope changes in the existing single commit attempt, applying the **Human edits and provenance** policy in `$CODEINFO_ROOT/codeinfo_markdown/codeinfo2_implement_story/shared.md`. If no eligible changes exist, skip the commit. Do not stage unresolved conflicts, secrets, or out-of-scope content.
5. Re-read and report the working-tree inventory immediately after the commit attempt. Preserve edits that arrive afterward for the next normal publication; do not create a follow-up commit or retry procedure in this checkpoint.
6. Push the current story branch when the repository is on the expected branch and the commit state is safe to push. If commit or push fails, report the failure and continue with the remaining repositories.

Never amend, rewrite, reset, clean, discard, or otherwise hide repository content to make the checkpoint appear successful.

## Output

Report, repository by repository:

1. The branch and initial `HEAD`.
2. Whether pre-existing changes were committed and the resulting commit SHA.
3. Whether unexpected post-checkpoint working-tree changes appeared.
4. Whether push succeeded, was safely skipped, or failed.
5. Any work deliberately left for the next implementation-loop iteration.
