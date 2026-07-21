# Record the current review batch outcome

Read the current batch inputs and immutable target snapshot, job outputs, verification, filtered reconciliation, disposition, every normal or stronger repair audit that exists, current Git state for every target repository, and the bounded plan. Discover the self-describing repair evidence instead of depending on an exact audit filename or schema.

Write a self-describing batch outcome under `reconciliation/` that accounts for every actionable finding and explains what the normal agent fixed, what the stronger agent fixed or why it was skipped, which findings remain after both opportunities, and what repair coverage was unavailable. Record every target repository's reviewed, initial-repair, and final HEAD when available, its exact repair commits and tests, and whether a new committed HEAD in any target makes another review useful.

Treat a normal-agent completion decision as sufficient to skip the stronger attempt only when the batch evidence positively supports that no actionable finding remains. A missing or failed stronger attempt after unresolved work was reported remains honest unavailable repair coverage, not success. Findings that remain only after the stronger opportunity may be recommended for complete-pass task settlement. Do not encode fast/slow identity, provider-specific logic, reviewer counts, or rigid output parsing.
