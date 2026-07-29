# Prove the final bugfix components build and start

Continue only with the story and subtask bound throughout the current loop. Read and follow `AGENTS.md`. Run `python3 "$CODEINFO_ROOT/scripts/flow_control/get_next_bugfix_subtask.py"` again and inspect fresh Git state. Continue only when the selector still returns `status: "ready"` for the same In Progress subtask assigned to the current user and the branch still matches the baseline in `information.md`. Do not adopt another issue, edit product source, commit, push, publish to Jira, or change Jira state during this step.

Read the bound subtask's `information.md`, `plan.md`, current diff, and any stronger-repair evidence. Identify every component materially modified for this subtask. Use repository-owned commands and wrapper scripts from `AGENTS.md` and the repository documentation to prove each affected component:

1. Builds successfully.
2. Starts successfully using its supported startup path.
3. Reaches a meaningful ready state proven by a health endpoint, expected startup marker, supported smoke request, or similarly direct evidence.
4. Stops cleanly when this step started it.

Do not treat a launched process, running container, or skipped command as successful startup proof. Do not use raw Docker commands when a repository-owned wrapper exists. Do not expose secrets or print complete environments. Preserve any environment that was already running before this step, stop only processes or stacks this step can positively identify as its own, and restore the original state as closely as repository-supported commands permit.

When a stronger repair changed code, rerun the focused tests, formatting checks, or other mandatory proof made stale by that repair before accepting the final runtime result. A pre-existing or external failure may be recorded honestly, but it is not a pass.

Append or refresh an `## Final build and startup proof` section in `information.md` containing:

- The affected components and why each is in scope.
- Every build, startup, readiness, smoke, and shutdown command attempted.
- The outcome and concise evidence for each command.
- Whether the original runtime state was restored.
- Every remaining blocker or uncertainty.
- Whether the subtask has complete final automated and runtime proof.

Before recording the frontend decision, create the selector-provided `proof` directory when needed and remove its existing direct-child image files. Those files are non-committed scratch evidence from an earlier pass and must not be mistaken for current proof. Do not remove downloaded Jira attachments or anything outside this selected subtask's proof directory.

Then create or refresh the exact selector-provided `frontend_proof` file. It must contain exactly one JSON property and no explanatory properties:

```json
{"required":true}
```

Use `true` when the actual final diff changes any browser-visible or browser-accessible frontend surface, when Jira acceptance criteria require browser proof, or when the answer is uncertain. Use:

```json
{"required":false}
```

only when current repository and Git evidence positively establishes that no frontend surface changed and no browser proof is required. Put the human-readable rationale in `information.md`, not in the JSON file. Creating this decision does not itself prove the frontend.
