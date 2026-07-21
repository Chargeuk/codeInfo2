# Reconcile the current review batch

Read the current review-batch handoff and inspect every discovered job directory. Do not use provider names, an expected reviewer count, pointer files, or a required result schema to decide what exists.

Understand each self-describing output and verification report. Reconcile supported findings, duplicates, severity disagreements, target ownership, exclusions, unavailable work, and residual uncertainty. Preserve useful sibling findings when another job is partial or unavailable.

Write a clear batch reconciliation under the batch's `reconciliation/` directory. Include enough provenance for later disposition agents to reopen the original job evidence. Do not edit the story plan or implementation in this step.

Run `python3 "$CODEINFO_ROOT/scripts/check_review_workspace.py" --batch-root <batch-directory>` as a factual preflight. `CODEINFO_ROOT` is the workflow harness root, not the target repository. Repair structural problems when possible, record any remaining limitation, and continue with whatever trustworthy job evidence is available.
