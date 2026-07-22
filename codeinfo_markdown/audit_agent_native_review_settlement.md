# Audit the agent-native review settlement

Independently read every batch and every factual record under the active review pass's `attempts/` directory, both repair attempts, the settlement, current Git state for every target repository, and the bounded plan. Interpret imperfect self-describing evidence by meaning rather than exact filenames, schemas, reviewer counts, or scheduling groups. Verify that a failed launch without a batch remains visible as unavailable coverage; that all supported findings were fixed, ignored with reason, or represented by appropriate tasks; that fixes by either agent caused a final testing task; that only findings remaining after the stronger opportunity became implementation tasks; that remaining work is followed by a final testing task covering every changed target; and that a clean closeout was not claimed while actionable work remains.

Read `$CODEINFO_ROOT/codeinfo_markdown/task_up/01-shared-contract.md` and `$CODEINFO_ROOT/codeinfo_markdown/task_up/09-proof-and-testing.md`. Audit every created or changed task semantically: `Testing` may contain runnable automated proof only, while browser, screenshot, agent-driven, and other manual scenarios belong only in checkbox-free, non-blocking `Manual Testing Guidance`. If settlement misplaced a manual item, repair the plan directly by preserving its meaning in manual guidance, removing only the misplaced checklist item, and retiring any blocker whose sole reason was waiting for the manual-testing agent.

Reject or repair settlement when a disposition prediction was tasked before repair was attempted, a successful fix was also tasked, a missing or failed repair stage was represented as success, a secondary-repository commit was omitted, or a new target HEAD was not routed to repeated review or final revalidation as appropriate.

Repair the settlement and plan when needed. Keep review grouping out of the artifacts: reviewer scheduling is not finding provenance.

You alone decide the active review cycle's final control outcome after interpreting and repairing the flexible evidence. Read `codeInfoStatus/flow-state/active-review-cycle.json` and, before finishing, run exactly one of these commands with its current `review_cycle_id`:

- Fully settled: `python3 "$CODEINFO_ROOT/scripts/record_review_cycle_outcome.py" --repo-root . --cycle-id '<review_cycle_id>' --status completed`
- Not fully settled after best-effort repair: `python3 "$CODEINFO_ROOT/scripts/record_review_cycle_outcome.py" --repo-root . --cycle-id '<review_cycle_id>' --status incomplete --reason '<honest reason>'`

Record `completed` only when every supported finding is fixed, deliberately ignored with a recorded reason, or represented by correctly ordered plan work and final revalidation. If the command reports an error, inspect the current control files and retry safely; never claim clean completion merely because a provider, command, or settlement step failed.
