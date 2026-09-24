# Prove the final bugfix components build and start

Continue only with the story and subtask bound throughout the current loop. Read and follow `AGENTS.md`. Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_bound_bugfix_subtask.py"` and inspect fresh Git state. Continue only when the helper returns `status: "ready"` for the same durably bound In Progress subtask, reports `assigned_to_current_user: true`, and the branch still matches the baseline in `information.md`. Never run the next-work selector. Do not adopt another issue, edit product source, commit, push, publish to Jira, or change Jira state during this step.

Read the bound subtask's `information.md`, `plan.md`, current diff, and any stronger-repair evidence. Identify every component materially modified for this subtask. Use repository-owned commands and wrapper scripts from `AGENTS.md` and the repository documentation to prove each affected component where local proof is possible:

1. Builds successfully.
2. Starts successfully using its supported startup path.
3. Reaches a meaningful ready state proven by a health endpoint, expected startup marker, supported smoke request, or similarly direct evidence.
4. Stops cleanly when this step started it.

Do not treat a launched process, running container, or skipped command as successful startup proof. Do not use raw Docker commands when a repository-owned wrapper exists. Do not expose secrets or print complete environments. Preserve any environment that was already running before this step, stop only processes or stacks this step can positively identify as its own, and restore the original state as closely as repository-supported commands permit.

When a stronger repair changed code, rerun the focused tests, formatting checks, or other mandatory proof made stale by that repair before accepting the final runtime result. A pre-existing or external failure may be recorded honestly, but it is not a pass.

Some fixes can be conclusively verified only in the deployed Dev environment because the repaired behavior depends on deployment-only infrastructure, configuration, topology, traffic, or observability that this repository cannot faithfully reproduce locally. Accept that classification only when `plan.md`, `information.md`, current repository guidance, and the actual change positively support it. Slow startup, difficult setup, a transient failure, or an ordinary locally reproducible error is not sufficient.

For a positively established Dev-only verification condition, make a reasonable best-effort attempt at every safe, locally applicable build, startup, readiness, smoke, and cleanup check. Preserve each real outcome: never relabel a failed or unavailable check as passed. A lack of conclusive local runtime proof is non-blocking for later closure only when all of the following are true:

- The implementation and all locally applicable automated checks are complete.
- The local limitation is inherent to the Dev-only behavior rather than caused by the implementation.
- No local result indicates an implementation-caused failure.
- The exact Dev verification condition and why local execution cannot prove it are recorded.
- The Jira publication step can clearly disclose the limitation and the Dev verification still required.

Append or refresh an `## Final build and startup proof` section in `information.md` containing:

- The affected components and why each is in scope.
- Every build, startup, readiness, smoke, and shutdown command attempted.
- The outcome and concise evidence for each command.
- Whether the original runtime state was restored.
- Every remaining blocker or uncertainty.
- Whether verification is local or Dev-only; for Dev-only verification, the exact reason, best-effort local outcomes, and the concrete check to perform in Dev.
- Whether the subtask has complete final automated and runtime proof.

Before recording the frontend decision, create the bound-task-helper-provided `proof` directory when needed and remove its existing direct-child image files. Those files are non-committed scratch evidence from an earlier pass and must not be mistaken for current proof. Do not remove downloaded Jira attachments or anything outside this bound subtask's proof directory.

Then create or refresh the exact bound-task-helper-provided `frontend_proof` file. It must contain exactly one JSON property and no explanatory properties:

```json
{ "required": true }
```

Use `true` when the actual final diff changes any browser-visible or browser-accessible frontend surface, when Jira acceptance criteria require browser proof, or when the answer is uncertain. Use:

```json
{ "required": false }
```

only when current repository and Git evidence positively establishes that no frontend surface changed and no browser proof is required. Put the human-readable rationale in `information.md`, not in the JSON file. Creating this decision does not itself prove the frontend.
