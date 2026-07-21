# Record the current review batch outcome

Read the current batch inputs, job outputs, verification, reconciliation, disposition, direct-fix audit, current Git state, and bounded plan.

Write a self-describing batch outcome under `reconciliation/` that explains whether supported direct fixes were made, whether another review of a new committed HEAD is useful, which findings remain task-required, what coverage was unavailable, and what the next scheduling decision should consider. Do not encode fast/slow identity or depend on a fixed filename from another reviewer.
