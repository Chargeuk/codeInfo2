# Audit the agent-native review settlement

Independently read every batch in the active review pass, both repair attempts, the settlement, current Git state for every target repository, and the bounded plan. Verify that all supported findings were fixed, ignored with reason, or represented by appropriate tasks; that fixes by either agent caused a final testing task; that only findings remaining after the stronger opportunity became implementation tasks; that remaining work is followed by a final testing task covering every changed target; and that a clean closeout was not claimed while actionable work remains.

Reject or repair settlement when a disposition prediction was tasked before repair was attempted, a successful fix was also tasked, a missing or failed repair stage was represented as success, a secondary-repository commit was omitted, or a new target HEAD was not routed to repeated review or final revalidation as appropriate.

Repair the settlement and plan when needed. Keep review grouping out of the artifacts: reviewer scheduling is not finding provenance.

You alone decide the active review cycle's final control outcome after interpreting and repairing the flexible evidence. Read `codeInfoStatus/flow-state/active-review-cycle.json` and, before finishing, run exactly one of these commands with its current `review_cycle_id`:

- Fully settled: `python3 "$CODEINFO_ROOT/scripts/record_review_cycle_outcome.py" --repo-root . --cycle-id '<review_cycle_id>' --status completed`
- Not fully settled after best-effort repair: `python3 "$CODEINFO_ROOT/scripts/record_review_cycle_outcome.py" --repo-root . --cycle-id '<review_cycle_id>' --status incomplete --reason '<honest reason>'`

Record `completed` only when every supported finding is fixed, deliberately ignored with a recorded reason, or represented by correctly ordered plan work and final revalidation. If the command reports an error, inspect the current control files and retry safely; never claim clean completion merely because a provider, command, or settlement step failed.
