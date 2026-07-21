# Disposition the current review batch

Read the current batch reconciliation and reopen job evidence as needed. Read the bounded story scope and current plan through repository helpers.

For every supported finding, decide whether it is duplicate/already resolved, outside scope, a direct fix suitable for this review pass, or work requiring its own implementation task. Explain each decision in a self-describing disposition file under `reconciliation/`. Preserve task-required findings for complete-pass settlement.

Record the current batch's accepted and ignored review decisions in the plan without rewriting historical review blocks. Do not require provider-specific fields or pointer state.
