# Verify and recover review batch jobs

Read and follow `$CODEINFO_ROOT/codeinfo_markdown/shared/review-artifact-handoff.md` for every applicable job output and verification handoff owned by this step.

Read `codeInfoStatus/flow-state/current-plan.json` only to identify the story, preserving the exact padded identifier from the plan filename (for example, `0000064`, not `64`). Set `batch_handoff` to `codeInfoTmp/reviews/<exact-story-id>-current-review-batch.md`, then set `batch_dir` exactly once by running `batch_dir="$(python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" resolve --batch-handoff "$batch_handoff")"`. Reuse those exact variables for every read, write, and check in this invocation. If resolution fails, report the batch as unavailable; never search for, reconstruct, or switch to a similar-looking sibling path.

Discover every directory directly below the batch's `jobs/` directory. Do not use a hard-coded reviewer list or expected count. For every job:

1. Read `job.md`, the assigned input, all `work/` material, including optional `work/review-usage/` evidence, all `output/` material, and any existing verification notes.
2. Check important factual claims with Git, filesystem, bounded plan, and test tools.
3. Decide whether the output honestly communicates what occurred, including exact commits, useful findings, exclusions, incomplete coverage, and uncertainty.
4. Write a self-describing verification report under that job's `verification/` directory.
5. If output is missing or misleading but work artifacts are useful, recover or repair only that job's output directly.
6. If nothing trustworthy exists, write an honest unavailable explanation under `output/` so the empty job cannot disappear.

When optional usage evidence exists, verify only its factual ownership and meaning: it must belong to the assigned job and explicitly designated actual-review work, with input, cached input, and output preserved separately. Do not require usage, infer missing values, add cached input to input, or let usage affect review validity or outcome. Record uncertainty in verification and continue.

Never reject useful findings merely because their filenames or formatting are unexpected. The scheduler owns `batch-launch.md`, shared `inputs/`, every job directory, and every `job.md`; these are immutable evidence for this step. Do not create, replace, or rewrite them when they are missing or inconsistent. Record the structural evidence gap in the affected job's verification or output artifact and continue with trustworthy evidence only. Do not modify implementation code, the plan, another batch, or provider pointers.

Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" check --batch-handoff "$batch_handoff"` before completing. `CODEINFO_ROOT` is the workflow harness root, not the target repository. Use factual failures to correct only verifier-owned output or verification artifacts; never fabricate runtime-owned structure to make the check pass. Empty-output warnings must be resolved through recovery or an honest unavailable explanation, but the checker deliberately does not interpret review meaning.

Before returning, enumerate the actual regular files under every discovered job's assigned `output/` and `verification/` directories. Each directory must contain a non-empty self-describing file for that job. Reopen the discovered files, confirm their paths remain inside the exact job boundary, and recover or write an honest unavailable account when either applicable handoff is empty; never rely on the name or link printed in an earlier chat response.
