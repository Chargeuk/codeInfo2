# Verify and recover review batch jobs

Read `codeInfoStatus/flow-state/current-plan.json` only to identify the story, preserving the exact padded identifier from the plan filename (for example, `0000064`, not `64`). Set `batch_handoff` to `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`, then set `batch_dir` exactly once by running `batch_dir="$(python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" resolve --batch-handoff "$batch_handoff")"`. Reuse those exact variables for every read, write, and check in this invocation. If resolution fails, report the batch as unavailable; never search for, reconstruct, or switch to a similar-looking sibling path.

Discover every directory directly below the batch's `jobs/` directory. Do not use a hard-coded reviewer list or expected count. For every job:

1. Read `job.md`, the assigned input, all `work/` material, all `output/` material, and any existing verification notes.
2. Check important factual claims with Git, filesystem, bounded plan, and test tools.
3. Decide whether the output honestly communicates what occurred, including exact commits, useful findings, exclusions, incomplete coverage, and uncertainty.
4. Write a self-describing verification report under that job's `verification/` directory.
5. If output is missing or misleading but work artifacts are useful, recover or repair only that job's output directly.
6. If nothing trustworthy exists, write an honest unavailable explanation under `output/` so the empty job cannot disappear.

Never reject useful findings merely because their filenames or formatting are unexpected. The scheduler owns `batch-launch.md`, shared `inputs/`, every job directory, and every `job.md`; these are immutable evidence for this step. Do not create, replace, or rewrite them when they are missing or inconsistent. Record the structural evidence gap in the affected job's verification or output artifact and continue with trustworthy evidence only. Do not modify implementation code, the plan, another batch, or provider pointers.

Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" check --batch-handoff "$batch_handoff"` before completing. `CODEINFO_ROOT` is the workflow harness root, not the target repository. Use factual failures to correct only verifier-owned output or verification artifacts; never fabricate runtime-owned structure to make the check pass. Empty-output warnings must be resolved through recovery or an honest unavailable explanation, but the checker deliberately does not interpret review meaning.
