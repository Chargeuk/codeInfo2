# Verify and recover review batch jobs

Read `codeInfoStatus/flow-state/current-plan.json` only to identify the story, preserving the exact padded identifier from the plan filename (for example, `0000064`, not `64`). Then read `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`. If the identifier is unclear, discover only the `*-current-review-batch.md` navigation files and confirm the story inside. Treat the referenced immutable batch directory as the complete scope for this step.

Discover every directory directly below the batch's `jobs/` directory. Do not use a hard-coded reviewer list or expected count. For every job:

1. Read `job.md`, the assigned input, all `work/` material, all `output/` material, and any existing verification notes.
2. Check important factual claims with Git, filesystem, bounded plan, and test tools.
3. Decide whether the output honestly communicates what occurred, including exact commits, useful findings, exclusions, incomplete coverage, and uncertainty.
4. Write a self-describing verification report under that job's `verification/` directory.
5. If output is missing or misleading but work artifacts are useful, recover or repair the output directly.
6. If nothing trustworthy exists, write an honest unavailable explanation under `output/` so the empty job cannot disappear.

Never reject useful findings merely because their filenames or formatting are unexpected. Do not modify implementation code, the plan, another batch, or provider pointers.

Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" --batch-root <batch-directory>` before completing. `CODEINFO_ROOT` is the workflow harness root, not the target repository. Use the checker's factual directory and containment failures to repair the workspace where possible. Empty-output warnings must be resolved through recovery or an honest unavailable explanation, but the checker deliberately does not interpret review meaning.
