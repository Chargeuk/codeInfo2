# Reconcile the current review batch

This is an autonomous flow execution step, not a planning interview. The required outcome and boundaries are already decided. Do not ask the user questions, offer choices, wait for confirmation, or finish with a question. Resolve uncertainty from the immutable batch evidence, make the best safe judgement available, and record uncertainty in the artifact.

Read the current review-batch handoff and inspect every discovered job directory. Do not use provider names, an expected reviewer count, pointer files, or a required result schema to decide what exists.

Understand each self-describing output and verification report. Reconcile supported findings, duplicates, severity disagreements, target ownership, exclusions, unavailable work, and residual uncertainty. Preserve useful sibling findings when another job is partial or unavailable.

Always write a clear batch reconciliation under the batch's `reconciliation/` directory. When complete reconciliation is impossible, still write an honest partial or unavailable reconciliation that explains what was inspected, what remains unknown, and why; never substitute clarification questions for the artifact. Include enough provenance for later disposition agents to reopen the original job evidence. Copy the batch identity and paths from the authoritative current-batch handoff or `batch-launch.md` rather than reconstructing them. Do not edit the story plan or implementation in this step.

Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" --batch-root <batch-directory>` as a factual preflight. `CODEINFO_ROOT` is the workflow harness root, not the target repository. Repair structural problems when possible, record any remaining limitation, and continue with whatever trustworthy job evidence is available.

Before returning, reopen the written reconciliation, confirm that it is non-empty, refers to the exact authoritative batch, accounts for every discovered job, and states a completed, partial, or unavailable result in ordinary prose. Return a concise execution summary and artifact path, not questions.
