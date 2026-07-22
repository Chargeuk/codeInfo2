# Audit the current batch reconciliation

This is an autonomous recovery step. Do not ask the user questions, offer choices, wait for confirmation, or finish with a question. Use immutable evidence and best judgement, preserving uncertainty explicitly.

Read the immutable current batch, every job directory, and the reconciliation. Independently check that no job or supported finding disappeared, no unavailable review was reported as clean coverage, target ownership remains clear, and contradictions are visible.

Treat a missing, empty, question-only, or non-executed reconciliation as a recoverable reconciliation failure, even when the prior agent turn reported provider success. Reconstruct the reconciliation from job evidence when necessary. Use factual tools where useful. Repair the reconciliation in place when it is incomplete, misleading, or refers to an identity or path that differs from the authoritative current-batch handoff. Record the audit beside it even when no repair is needed. Formatting differences are not errors; loss of meaning or evidence is.

Copy batch identities and paths from the authoritative handoff or `batch-launch.md`; do not reconstruct them. Before returning, reopen both reconciliation and audit, confirm they are non-empty and refer to the exact batch, and report the artifact paths without asking follow-up questions.
